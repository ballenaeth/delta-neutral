/* ============================================================================
   TIDEWRIGHT — pons.js
   The chart is the tide. A pons v2 launch on Robinhood Chain (4663), read
   straight off the bonding curve with raw JSON-RPC — no wallet library, no
   ABI library, in keeping with the rest of the game. The trust path is the
   chain: nothing here depends on the pons website being up.

   What it gives the game:
     T.Pons.state      price, drawdown from the recent peak, curve progress,
                       graduation, your bag, the last trade seen
     T.Pons.setToken   point it at a launch (the factory tells us its curve)
     T.Pons.connect    an injected wallet, switched to Robinhood Chain
     T.Pons.buy/sell   trades on the curve, quoted the way the docs say
     T.Pons.recent     the latest launches, from TokenLaunched logs
   ========================================================================== */
'use strict';

(function (T) {

const CHAIN_ID = 4663, CHAIN_HEX = '0x1237';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const FACTORY_V2 = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const LAUNCHPAD = 'https://www.ponsfamily.com/launchpad';
const BPS = 10000n;

/* selectors and topics — keccak-256 of the signatures, computed once */
const SEL = {
  balanceOf: '0x70a08231', totalSupply: '0x18160ddd', decimals: '0x313ce567',
  symbol: '0x95d89b41', name: '0x06fdde03', allowance: '0xdd62ed3e', approve: '0x095ea7b3',
  getReserves: '0x0902f1ac', sellableTokens: '0x808bcddc', feeBps: '0x24a9d853',
  creatorTaxBps: '0xc1bb8901', currentSnipeTaxBps: '0xd7e1ef39', graduationThreshold: '0x8b0bc501',
  realQuoteReserve: '0x4f1f58fd', reservedTokens: '0x15a55347', readyToGraduate: '0xc68360a5',
  graduated: '0xe7c2b772', buy: '0x59a87bc1', sell: '0xd04c6983', pairToken: '0x3de35b79',
  isNativeQuote: '0xdc08e094', getLaunchedToken: '0x3cf28b5a', canLaunch: '0x58373f04'
};
const TOPIC = {
  TokenLaunched: '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607'
};

/* ─────────────────────────── abi bits ─────────────────────────── */
const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const word = v => BigInt(v).toString(16).padStart(64, '0');
const addrWord = a => a.toLowerCase().replace('0x', '').padStart(64, '0');
const enc = (sel, ...words) => sel + words.join('');
const words = hex => {
  const h = (hex || '0x').replace('0x', '');
  const out = [];
  for (let i = 0; i + 64 <= h.length; i += 64) out.push(BigInt('0x' + h.slice(i, i + 64)));
  return out;
};
const wAddr = w => '0x' + w.toString(16).padStart(40, '0');
const decodeString = hex => {
  try {
    const h = hex.replace('0x', '');
    if (h.length === 64) {                       // bytes32-style symbol
      return hexToUtf8(h.replace(/(00)+$/, ''));
    }
    const off = Number(BigInt('0x' + h.slice(0, 64))) * 2;
    const len = Number(BigInt('0x' + h.slice(off, off + 64))) * 2;
    return hexToUtf8(h.slice(off + 64, off + 64 + len));
  } catch (e) { return ''; }
};
const hexToUtf8 = h => {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
  return new TextDecoder().decode(b).replace(/\0+$/, '');
};

/* ─────────────────────────── rpc ─────────────────────────── */
let rpcId = 1, rpcUrl = RPC, triedProxy = false;
async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params: params || [] });
  let r;
  try {
    r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  } catch (e) {
    /* a browser that will not talk to the RPC directly (CORS) can go through
       server.js, which forwards /rpc to the chain */
    if (!triedProxy && rpcUrl === RPC && location.protocol !== 'file:') {
      triedProxy = true; rpcUrl = '/rpc';
      return rpc(method, params);
    }
    throw e;
  }
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const callU = async (to, data) => { const w = words(await call(to, data)); return w.length ? w[0] : 0n; };

/* ─────────────────────────── state ─────────────────────────── */
const state = {
  ok: false, err: '', token: '', curve: '', symbol: '—', name: '', decimals: 18,
  supply: 0n, quoteReserve: 0n, tokenReserve: 0n, sellable: 0n, reserved: 0n,
  realQuote: 0n, threshold: 0n, feeBps: 0n, creatorTaxBps: 0n,
  pairToken: WETH, isNative: true, quoteDecimals: 18,
  graduated: false, readyToGraduate: false,
  price: 0, peak: 0, drawdown: 0, flood: 0, progress: 0, mcap: 0,
  account: '', balance: 0n, bagFrac: 0, quoteBalance: 0n,
  lastTrade: null, tradeSeq: 0, updatedAt: 0, polls: 0,
  history: []
};
const listeners = {};
const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
const emit = (ev, a) => (listeners[ev] || []).forEach(fn => { try { fn(a); } catch (e) { console.error(e); } });

/* the peak the drawdown is measured from: the highest price in the last
   WINDOW minutes, so a token that pumped and settled gets its low water back */
let WINDOW_MS = 20 * 60 * 1000;
let FLOOD_AT = 0.30;            // this much drawdown from the peak is full flood
const opt = new URLSearchParams(location.search);
if (opt.get('window')) WINDOW_MS = Math.max(1, +opt.get('window')) * 60 * 1000;
if (opt.get('flood')) FLOOD_AT = T.clamp(+opt.get('flood'), 0.03, 0.95);

function histKey() { return 'tw.pons.hist.' + state.token.toLowerCase(); }
function pushPrice(p) {
  const now = Date.now();
  state.history.push([now, p]);
  const cut = now - WINDOW_MS;
  while (state.history.length > 2 && state.history[0][0] < cut) state.history.shift();
  if (state.history.length > 600) state.history.splice(0, state.history.length - 600);
  T.store.set(histKey(), state.history);
  let peak = 0;
  for (const h of state.history) if (h[1] > peak) peak = h[1];
  state.peak = peak;
  state.drawdown = peak > 0 ? T.clamp(1 - p / peak, 0, 1) : 0;
  const k = T.clamp(state.drawdown / FLOOD_AT, 0, 1);
  state.flood = k * k * (3 - 2 * k);
}

/* ─────────────────────────── the launch ─────────────────────────── */
let pollTimer = 0, polling = false;

async function setToken(addr) {
  if (!isAddr(addr)) throw new Error('That is not an address.');
  stop();
  Object.assign(state, {
    ok: false, err: '', token: addr, curve: '', symbol: '—', name: '', graduated: false,
    price: 0, peak: 0, drawdown: 0, flood: 0, progress: 0, lastTrade: null, history: [],
    balance: 0n, bagFrac: 0
  });
  const w = words(await call(FACTORY_V2, enc(SEL.getLaunchedToken, addrWord(addr))));
  /* LaunchedToken is a static struct, so it comes back inline: token, curve,
     deployer, creatorFeeRecipient, pairToken, graduationThreshold, ... exists */
  if (w.length < 15 || wAddr(w[0]).toLowerCase() !== addr.toLowerCase() || w[14] === 0n)
    throw new Error('The v2 factory does not know this token. Only pons v2 launches have a curve to read.');
  state.curve = wAddr(w[1]);
  state.pairToken = wAddr(w[4]);
  state.threshold = w[5];
  state.history = T.store.get(histKey(), []) || [];
  const [sym, name, dec, sup, isNative] = await Promise.all([
    call(addr, SEL.symbol).then(decodeString).catch(() => '???'),
    call(addr, SEL.name).then(decodeString).catch(() => ''),
    callU(addr, SEL.decimals).catch(() => 18n),
    callU(addr, SEL.totalSupply),
    callU(state.curve, SEL.isNativeQuote).then(v => v !== 0n).catch(() => true)
  ]);
  state.symbol = sym || '???'; state.name = name; state.decimals = Number(dec); state.supply = sup;
  state.isNative = isNative;
  if (!isNative) state.quoteDecimals = Number(await callU(state.pairToken, SEL.decimals).catch(() => 18n));
  await poll();
  start();
  return state;
}

async function poll() {
  if (!state.curve || polling) return;
  polling = true;
  try {
    const c = state.curve;
    const [res, sellable, reserved, realQ, fee, tax, grad, ready] = await Promise.all([
      call(c, SEL.getReserves).then(words),
      callU(c, SEL.sellableTokens), callU(c, SEL.reservedTokens).catch(() => 0n),
      callU(c, SEL.realQuoteReserve).catch(() => 0n),
      callU(c, SEL.feeBps), callU(c, SEL.creatorTaxBps),
      callU(c, SEL.graduated).then(v => v !== 0n), callU(c, SEL.readyToGraduate).then(v => v !== 0n).catch(() => false)
    ]);
    const prevQ = state.quoteReserve, prevT = state.tokenReserve, wasGrad = state.graduated;
    state.quoteReserve = res[0] || 0n; state.tokenReserve = res[1] || 0n;
    state.sellable = sellable; state.reserved = reserved; state.realQuote = realQ;
    state.feeBps = fee; state.creatorTaxBps = tax;
    state.graduated = grad; state.readyToGraduate = ready;
    /* spot: quote per token, both scaled to their own decimals */
    const q = Number(state.quoteReserve) / 10 ** state.quoteDecimals;
    const t = Number(state.tokenReserve) / 10 ** state.decimals;
    state.price = t > 0 ? q / t : state.price;
    state.mcap = state.price * Number(state.supply) / 10 ** state.decimals;
    if (state.threshold > 0n) state.progress = T.clamp(Number(realQ) / Number(state.threshold), 0, 1);
    else if (state.supply > 0n) state.progress = T.clamp(Number(state.supply - sellable) / Number(state.supply - reserved), 0, 1);
    if (grad) state.progress = 1;
    pushPrice(state.price);
    /* a trade shows up as the reserves moving between two polls */
    if (state.polls > 0 && state.quoteReserve !== prevQ) {
      const dq = Number(state.quoteReserve - prevQ) / 10 ** state.quoteDecimals;
      const dt = Number(prevT - state.tokenReserve) / 10 ** state.decimals;
      state.lastTrade = { side: dq > 0 ? 'buy' : 'sell', quote: Math.abs(dq), tokens: Math.abs(dt), at: Date.now() };
      state.tradeSeq++;
      emit('trade', state.lastTrade);
    }
    if (grad && !wasGrad && state.polls > 0) emit('graduated', state);
    if (state.account) await refreshBag();
    state.polls++; state.updatedAt = Date.now(); state.ok = true; state.err = '';
    emit('update', state);
  } catch (e) {
    state.err = e.message || String(e); state.ok = false;
    emit('error', state.err);
  } finally { polling = false; }
}
function start() { stop(); pollTimer = setInterval(poll, 6000); }
function stop() { if (pollTimer) clearInterval(pollTimer); pollTimer = 0; }

async function refreshBag() {
  if (!state.account || !state.token) return;
  state.balance = await callU(state.token, enc(SEL.balanceOf, addrWord(state.account)));
  state.bagFrac = state.supply > 0n ? Number(state.balance) / Number(state.supply) : 0;
  state.quoteBalance = state.isNative
    ? BigInt(await rpc('eth_getBalance', [state.account, 'latest']))
    : await callU(state.pairToken, enc(SEL.balanceOf, addrWord(state.account)));
}

/* ─────────────────────────── the wallet ─────────────────────────── */
const eth = () => window.ethereum;
async function connect() {
  const p = eth();
  if (!p) throw new Error('No wallet in this browser. Install one, or play without a bag.');
  const accts = await p.request({ method: 'eth_requestAccounts' });
  const chain = await p.request({ method: 'eth_chainId' });
  if (parseInt(chain, 16) !== CHAIN_ID) {
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      if (e && (e.code === 4902 || /unrecognized|not added|4902/i.test(e.message || ''))) {
        await p.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: CHAIN_HEX, chainName: 'Robinhood Chain',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [RPC], blockExplorerUrls: [EXPLORER]
        }] });
      } else throw e;
    }
  }
  state.account = accts[0];
  p.on && p.on('accountsChanged', a => { state.account = a[0] || ''; refreshBag().then(() => emit('update', state)); });
  if (state.token) await refreshBag();
  emit('update', state);
  return state.account;
}

async function sendTx(tx) {
  const hash = await eth().request({ method: 'eth_sendTransaction', params: [tx] });
  /* wait for it — the wallet's provider sees the chain the user is on */
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const rc = await eth().request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (rc) {
      if (rc.status === '0x0' || rc.status === 0) throw new Error('The transaction reverted. ' + EXPLORER + '/tx/' + hash);
      return hash;
    }
  }
  throw new Error('Still pending: ' + EXPLORER + '/tx/' + hash);
}

async function ensureAllowance(tokenAddr, spender, amount) {
  const have = await callU(tokenAddr, enc(SEL.allowance, addrWord(state.account), addrWord(spender)));
  if (have >= amount) return;
  const max = (1n << 256n) - 1n;
  await sendTx({ from: state.account, to: tokenAddr, data: enc(SEL.approve, addrWord(spender), word(max)) });
}

/* ─────────────────────────── quoting ───────────────────────────
   Straight from docs.ponsfamily.com/v2#quoting. Every fee comes off the
   input on a buy; a sell is priced first and the fees come off the output. */
const amountOut = (inA, rIn, rOut) => (inA * rOut) / (rIn + inA);

async function quoteBuy(quoteIn) {
  const snipe = state.account ? await callU(state.curve, enc(SEL.currentSnipeTaxBps, addrWord(state.account))).catch(() => 0n) : 0n;
  const fee = (quoteIn * state.feeBps) / BPS;
  const tax = (quoteIn * state.creatorTaxBps) / BPS;
  const st = (quoteIn * snipe) / BPS;
  let out = amountOut(quoteIn - fee - tax - st, state.quoteReserve, state.tokenReserve);
  const capped = out > state.sellable;
  if (capped) out = state.sellable;
  return { tokensOut: out, fee, tax, snipe: st, snipeBps: snipe, capped };
}
function quoteSell(tokensIn) {
  const gross = amountOut(tokensIn, state.tokenReserve, state.quoteReserve);
  const fee = (gross * state.feeBps) / BPS;
  const tax = (gross * state.creatorTaxBps) / BPS;
  return { quoteOut: gross - fee - tax, fee, tax };
}

async function buy(quoteIn, slippageBps) {
  if (!state.account) await connect();
  if (state.graduated) throw new Error('This one has graduated — trade it in the pool: ' + LAUNCHPAD);
  await poll();
  const q = await quoteBuy(quoteIn);
  if (q.tokensOut <= 0n) throw new Error('Nothing would come out of that.');
  const minOut = q.tokensOut * (BPS - BigInt(slippageBps || 300)) / BPS;
  const tx = { from: state.account, to: state.curve,
               data: enc(SEL.buy, word(quoteIn), word(minOut), addrWord(state.account)) };
  if (state.isNative) tx.value = '0x' + quoteIn.toString(16);
  else await ensureAllowance(state.pairToken, state.curve, quoteIn);
  const hash = await sendTx(tx);
  await poll();
  emit('mytrade', { side: 'buy', hash });
  return hash;
}
async function sell(tokensIn, slippageBps) {
  if (!state.account) await connect();
  if (state.graduated) throw new Error('This one has graduated — trade it in the pool: ' + LAUNCHPAD);
  await poll();
  const q = quoteSell(tokensIn);
  if (q.quoteOut <= 0n) throw new Error('Nothing would come out of that.');
  const minOut = q.quoteOut * (BPS - BigInt(slippageBps || 300)) / BPS;
  await ensureAllowance(state.token, state.curve, tokensIn);
  const hash = await sendTx({ from: state.account, to: state.curve,
    data: enc(SEL.sell, word(tokensIn), word(minOut), addrWord(state.account)) });
  await poll();
  emit('mytrade', { side: 'sell', hash });
  return hash;
}

/* ─────────────────────────── recent launches ─────────────────────────── */
async function recent(want) {
  want = want || 10;
  const head = BigInt(await rpc('eth_blockNumber'));
  let span = 20000n, from = head, found = [], tries = 0;
  while (found.length < want && from > 0n && tries < 14) {
    const lo = from > span ? from - span : 0n;
    let logs;
    try {
      logs = await rpc('eth_getLogs', [{ address: FACTORY_V2, topics: [TOPIC.TokenLaunched],
        fromBlock: '0x' + lo.toString(16), toBlock: '0x' + from.toString(16) }]);
    } catch (e) {
      /* a node that caps the range says so with an error — narrow and retry */
      span = span / 4n; if (span < 500n) throw e; tries++; continue;
    }
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i];
      if (found.some(f => f.token === wAddr(BigInt(l.topics[1])))) continue;
      found.push({ token: wAddr(BigInt(l.topics[1])), curve: wAddr(BigInt(l.topics[2])),
                   deployer: wAddr(BigInt(l.topics[3])), block: parseInt(l.blockNumber, 16) });
    }
    from = lo - 1n; tries++;
  }
  found = found.slice(0, want);
  await Promise.all(found.map(async f => {
    f.symbol = await call(f.token, SEL.symbol).then(decodeString).catch(() => '???');
    f.name = await call(f.token, SEL.name).then(decodeString).catch(() => '');
    try {
      const [rq, th, g] = await Promise.all([callU(f.curve, SEL.realQuoteReserve), callU(f.curve, SEL.graduationThreshold), callU(f.curve, SEL.graduated)]);
      f.progress = th > 0n ? T.clamp(Number(rq) / Number(th), 0, 1) : 0;
      f.graduated = g !== 0n;
    } catch (e) { f.progress = 0; }
  }));
  return found;
}

/* ─────────────────────────── formatting ─────────────────────────── */
const fmt = {
  price: p => {
    if (!p) return '—';
    if (p >= 1) return p.toFixed(4) + ' ETH';
    const e = Math.floor(Math.log10(p));
    if (e >= -6) return p.toFixed(Math.min(10, 2 - e)) + ' ETH';
    return p.toExponential(2) + ' ETH';
  },
  eth: v => v >= 100 ? v.toFixed(1) + ' ETH' : v >= 1 ? v.toFixed(3) + ' ETH' : v >= 0.001 ? v.toFixed(4) + ' ETH' : (v * 1e6).toFixed(0) + ' gwei·k',
  big: (v, dec) => {
    const n = Number(v) / 10 ** (dec === undefined ? state.decimals : dec);
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(n < 10 ? 3 : 0);
  },
  pct: f => (f * 100).toFixed(f * 100 < 1 ? 2 : 1) + '%',
  short: a => a ? a.slice(0, 6) + '…' + a.slice(-4) : ''
};
const toWei = (s, dec) => {
  const [a, b = ''] = String(s).trim().split('.');
  const d = dec === undefined ? 18 : dec;
  return BigInt(a || '0') * 10n ** BigInt(d) + BigInt((b + '0'.repeat(d)).slice(0, d) || '0');
};

T.Pons = {
  CHAIN_ID, RPC, EXPLORER, FACTORY_V2, WETH, LAUNCHPAD,
  state, on, setToken, poll, start, stop, connect, refreshBag,
  quoteBuy, quoteSell, buy, sell, recent, fmt, toWei, isAddr,
  get floodAt() { return FLOOD_AT; }, get windowMin() { return WINDOW_MS / 60000; },
  hasWallet: () => !!window.ethereum,
  tokenUrl: () => LAUNCHPAD + '/' + state.token,
  explorerToken: () => EXPLORER + '/token/' + state.token
};

})(TW);
