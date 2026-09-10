# Boosters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the physical-leverage Boosters stack on Robinhood Chain: per-token fuel tanks fed by pons creator fees, a Booster vault that opens 2x–5x longs by really buying on the pons curve or the graduated v4 pool, permissionless liquidations, a graveyard that pays dead-bag burners from dead tanks, and a three.js client where every token is a rocket.

**Architecture:** Contracts first (Foundry, Solidity 0.8.26). `TankFactory` deploys one deterministic `FuelTank` clone per pons token; the tank is meant to be the token's `creatorFeeRecipient` and pulls its balances from the pons Fee Escrow. `Booster` borrows quote from a tank, buys real tokens on the live venue (curve before graduation, Uniswap v4 pool after), custodies them, marks every position at *realizable sell value* computed from venue reserves, and sells back to close or liquidate. `Graveyard` marks tokens dead by on-chain rules, drains their tanks into a pot, and pays burners pro rata after a 30-day window. No oracle, no owner, no upgrade path. The client reads the chain directly (factory logs, curve/StateView reads, Chainlink for the horizon line) and renders rockets, planets and the graveyard.

**Tech Stack:** Foundry 1.5 (`~/.foundry/bin`), Solidity 0.8.26 (evm cancun), OpenZeppelin Contracts 5.x (Clones, SafeERC20, ReentrancyGuard, Math), Uniswap v4 PoolManager/StateView (minimal local interfaces, no v4-core dependency), Node 23 for scripts, vanilla JS + three.js (importmap, no bundler) for the client, the tiny `server.js` RPC proxy pattern from the previous project.

**Design source:** `docs/plans/2026-09-10-boosters-validation-and-design.md`. Read §1 (facts), §3 (caveats) and §6 (decisions) before starting.

**Live addresses (Robinhood Chain, id 4663, verified 2026-09-10):**

| name | address |
|---|---|
| pons v2 factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| pons fee escrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |
| pons meme hook | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` |
| Uniswap v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| Uniswap v4 StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` (429 on bursts; `eth_getLogs` ≤ 10k logs) |
| a graduated ETH-quoted token (fork tests) | token `0x565f864edb37b46800add658c94df82e7ea175fe`, curve `0x02087C6d3AeF34Fc2DDAEF11Ce5579b0F9507a71`, tickSpacing 200 |

Numeric parameters (constructor args, tune before deploy): `maxImpactBps 500`, `maintenanceBps 1000` (realizable must stay ≥ 110% of debt), `borrowFeeBpsPerDay 10`, `openFeeBps 50` (of borrow), `liqPenaltyBps 2000` (of surplus), `keeperShareBps 5000` (of penalty), `curveMaxLev 2`, `lev3DepthX 5`, `lev5DepthX 12` (quote depth as multiples of graduation threshold).

---

## Phase 1 — Contracts

### Task 1: Foundry scaffold

**Files:**
- Create: `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/.gitignore`
- Modify: `.gitignore` (repo root, create if missing)

**Step 1: Init**

```bash
cd /Users/danipolo/dev/delta-neutral && mkdir -p contracts && cd contracts && export PATH=$PATH:$HOME/.foundry/bin && forge init --no-git --no-commit --force . && rm -rf src/Counter.sol test/Counter.t.sol script/Counter.s.sol
```

**Step 2: Dependencies**

```bash
cd /Users/danipolo/dev/delta-neutral/contracts && export PATH=$PATH:$HOME/.foundry/bin && forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
```

If `--no-git` is rejected by this forge version, run `git submodule add https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts && cd lib/openzeppelin-contracts && git checkout v5.1.0`.

**Step 3: Config**

`contracts/foundry.toml`:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.26"
evm_version = "cancun"
optimizer = true
optimizer_runs = 800
via_ir = false
fs_permissions = [{ access = "read", path = "./" }]

[rpc_endpoints]
robinhood = "${ROBINHOOD_RPC}"
```

`contracts/remappings.txt`:
```
@openzeppelin/=lib/openzeppelin-contracts/
forge-std/=lib/forge-std/src/
```

Root `.gitignore`:
```
contracts/out/
contracts/cache/
contracts/broadcast/
node_modules/
.env
.DS_Store
```

**Step 4: Verify build**

Run: `cd contracts && forge build`
Expected: `Compiler run successful` (no sources yet is fine).

**Step 5: Commit**

```bash
git add -A && git commit -m "chore: foundry scaffold for Boosters contracts"
```

---

### Task 2: External interfaces

**Files:**
- Create: `contracts/src/interfaces/IPonsCurve.sol`, `IPonsFactory.sol`, `IFeeEscrow.sol`, `IPoolManager.sol`, `IStateView.sol`

**Step 1: Write them**

`IPonsCurve.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// pons v2 bonding curve. Verified selectors: getReserves 0x0902f1ac, sellableTokens 0x808bcddc,
/// feeBps 0x24a9d853, creatorTaxBps 0xc1bb8901, realQuoteReserve 0x4f1f58fd, graduated 0xe7c2b772.
interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut);
    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
    function realQuoteReserve() external view returns (uint256);
    function sellableTokens() external view returns (uint256);
    function feeBps() external view returns (uint256);
    function creatorTaxBps() external view returns (uint256);
    function currentSnipeTaxBps(address recipient) external view returns (uint256);
    function readyToGraduate() external view returns (bool);
    function graduated() external view returns (bool);
    function graduationThreshold() external view returns (uint256);
    function pairToken() external view returns (address);
    function isNativeQuote() external view returns (bool);
}
```

`IPonsFactory.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPonsFactory {
    /// All static fields, so it ABI-decodes inline (15 words). Verified against the live factory.
    struct LaunchedToken {
        address token; address curve; address deployer; address creatorFeeRecipient; address pairToken;
        uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps;
        bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists;
    }
    struct FeePolicy {
        address protocolFeeRecipient; uint16 protocolFeeShareBps; uint16 buybackBurnBps;
        uint16 hookFeeBps; uint16 maxInternalPriceImpactBps;
    }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
    function getLaunchFeePolicy(address token) external view returns (FeePolicy memory);
    function transferCreatorFeeRecipient(address token, address newRecipient) external;
    function canLaunch(address who) external view returns (bool);
}
```

`IFeeEscrow.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// pons fee escrow. Pull-based. Verified live: balanceOf/balanceOfToken return values,
/// claim()/claimToken(address) revert with a typed error when nothing is claimable.
interface IFeeEscrow {
    function balanceOf(address recipient) external view returns (uint256);
    function balanceOfToken(address recipient, address token) external view returns (uint256);
    function claim() external;
    function claimToken(address token) external;
}
```

`IPoolManager.sol` (minimal Uniswap v4; address-backed user types collapse to `address`, `BalanceDelta` is `int256`):
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 delta);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

library V4 {
    uint160 internal constant MIN_SQRT_PRICE = 4295128739;
    uint160 internal constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;
    function amount0(int256 d) internal pure returns (int128) { return int128(d >> 128); }
    function amount1(int256 d) internal pure returns (int128) { return int128(d); }
    function poolId(PoolKey memory k) internal pure returns (bytes32) { return keccak256(abi.encode(k)); }
}
```

`IStateView.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IStateView {
    function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity);
}
```

**Step 2: Build**

Run: `cd contracts && forge build`
Expected: `Compiler run successful`.

**Step 3: Commit**

```bash
git add contracts/src/interfaces && git commit -m "feat: pons, escrow and v4 interfaces"
```

---

### Task 3: PonsMath library

**Files:**
- Create: `contracts/src/libraries/PonsMath.sol`
- Test: `contracts/test/PonsMath.t.sol`

**Step 1: Failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {PonsMath} from "../src/libraries/PonsMath.sol";

contract PonsMathTest is Test {
    // pons ETH launch: phantom 1.68 ETH, 1e9 supply, threshold 4.2 ETH
    uint256 q = 1.68 ether; uint256 t = 1e9 ether;

    function test_amountOut_matchesDocs() public pure {
        // (in * rOut) / (rIn + in)
        assertEq(PonsMath.amountOut(0.1 ether, 1.68 ether, 1e9 ether), 0.1 ether * 1e9 ether / 1.78 ether);
    }
    function test_amountIn_roundsUpAndInverts() public pure {
        uint256 out = PonsMath.amountOut(0.1 ether, 1.68 ether, 1e9 ether);
        uint256 back = PonsMath.amountIn(out, 1.68 ether, 1e9 ether);
        assertGe(back, 0.1 ether); assertLe(back - 0.1 ether, 2);
    }
    function test_quoteBuy_feesOffInput_thenClamp() public view {
        // 1% fee, 2% tax, 0 snipe: net = 0.097
        uint256 out = PonsMath.quoteBuy(0.1 ether, q, t, 100, 200, 0, type(uint256).max);
        assertEq(out, PonsMath.amountOut(0.097 ether, q, t));
        assertEq(PonsMath.quoteBuy(0.1 ether, q, t, 100, 200, 0, 5), 5);
    }
    function test_quoteSell_feesOffOutput() public view {
        uint256 gross = PonsMath.amountOut(1e6 ether, t, q);
        assertEq(PonsMath.quoteSell(1e6 ether, q, t, 100, 200), gross - gross / 100 - gross * 2 / 100);
    }
    function test_maxBuyForImpact_isConservative() public pure {
        // buying d against q moves spot by ((q+d)/q)^2 - 1; with d = q*m/2 that is < m
        uint256 d = PonsMath.maxBuyForImpact(100 ether, 500);
        assertEq(d, 2.5 ether);
        uint256 ratioBps = (100 ether + d) ** 2 / (100 ether) * 10_000 / (100 ether);
        assertLt(ratioBps, 10_500); assertGt(ratioBps, 10_490);
    }
}
```

**Step 2: Run, expect failure**

Run: `cd contracts && forge test --match-contract PonsMathTest`
Expected: compile error, `PonsMath` not found.

**Step 3: Implement**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// The pons v2 quoting formulas from docs.ponsfamily.com/v2#quoting, plus the impact bound Boosters uses.
library PonsMath {
    uint256 internal constant BPS = 10_000;

    function amountOut(uint256 inA, uint256 rIn, uint256 rOut) internal pure returns (uint256) {
        return inA * rOut / (rIn + inA);
    }
    function amountIn(uint256 outA, uint256 rIn, uint256 rOut) internal pure returns (uint256) {
        return outA * rIn / (rOut - outA) + 1;
    }
    /// Buy fees come off the input. Result is clamped to what is still sellable.
    function quoteBuy(uint256 quoteIn, uint256 q, uint256 t, uint256 feeBps, uint256 taxBps, uint256 snipeBps, uint256 sellable)
        internal pure returns (uint256 tokensOut)
    {
        uint256 net = quoteIn - quoteIn * feeBps / BPS - quoteIn * taxBps / BPS - quoteIn * snipeBps / BPS;
        tokensOut = amountOut(net, q, t);
        if (tokensOut > sellable) tokensOut = sellable;
    }
    /// Sell is priced first; fees come off the quote output.
    function quoteSell(uint256 tokensIn, uint256 q, uint256 t, uint256 feeBps, uint256 taxBps) internal pure returns (uint256) {
        uint256 gross = amountOut(tokensIn, t, q);
        return gross - gross * feeBps / BPS - gross * taxBps / BPS;
    }
    /// Largest constant-product buy whose spot impact stays under maxImpactBps: d = q*m/2 (sqrt(1+m)-1 <= m/2).
    function maxBuyForImpact(uint256 q, uint256 maxImpactBps) internal pure returns (uint256) {
        return q * maxImpactBps / (2 * BPS);
    }
}
```

**Step 4: Run, expect pass**

Run: `cd contracts && forge test --match-contract PonsMathTest -vv`
Expected: `5 passed`.

**Step 5: Commit**

```bash
git add contracts/src/libraries contracts/test/PonsMath.t.sol && git commit -m "feat: PonsMath with docs formulas and impact bound"
```

---

### Task 4: Test mocks — ERC20, fee escrow, a faithful pons curve

**Files:**
- Create: `contracts/test/mocks/MockERC20.sol`, `contracts/test/mocks/MockEscrow.sol`, `contracts/test/mocks/MockCurve.sol`
- Test: `contracts/test/MockCurve.t.sol`

The mock curve reproduces pons behaviour that Boosters depends on: phantom reserve, sellable/reserved split, fees off input/output credited to the escrow for the creator recipient, clamp-and-refund on the graduating buy, `readyToGraduate` when sellable hits zero, sells refused from that moment, `graduated` flipped by a test helper. Snipe tax is always zero in the mock.

**Step 1: Mocks**

`MockERC20.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _dec;
    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) { _dec = d; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}
```

`MockEscrow.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFeeEscrow} from "../../src/interfaces/IFeeEscrow.sol";

/// Pull-based like the real one. Curves (or tests) credit balances; recipients claim.
contract MockEscrow is IFeeEscrow {
    error NothingToClaim();
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public balanceOfToken;

    function credit(address to) external payable { balanceOf[to] += msg.value; }
    function creditToken(address to, address token, uint256 amt) external {
        IERC20(token).transferFrom(msg.sender, address(this), amt);
        balanceOfToken[to][token] += amt;
    }
    function claim() external {
        uint256 b = balanceOf[msg.sender]; if (b == 0) revert NothingToClaim();
        balanceOf[msg.sender] = 0; (bool ok,) = msg.sender.call{value: b}(""); require(ok);
    }
    function claimToken(address token) external {
        uint256 b = balanceOfToken[msg.sender][token]; if (b == 0) revert NothingToClaim();
        balanceOfToken[msg.sender][token] = 0; IERC20(token).transfer(msg.sender, b);
    }
}
```

`MockCurve.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPonsCurve} from "../../src/interfaces/IPonsCurve.sol";
import {PonsMath} from "../../src/libraries/PonsMath.sol";
import {MockEscrow} from "./MockEscrow.sol";

contract MockCurve is IPonsCurve {
    using PonsMath for uint256;
    error Graduated(); error SellsClosed(); error Slippage(); error BadValue();

    IERC20 public immutable token; address public immutable override pairToken; bool public immutable override isNativeQuote;
    MockEscrow public immutable escrow; address public immutable creator;
    uint256 public immutable override feeBps; uint256 public immutable override creatorTaxBps; uint256 public immutable override graduationThreshold;
    uint256 public quoteReserve; uint256 public tokenReserve; uint256 public override realQuoteReserve;
    uint256 public override sellableTokens; uint256 public reservedTokens; bool public override graduated;

    constructor(IERC20 token_, address pair, uint256 phantom, uint256 threshold, uint256 fee, uint256 tax, MockEscrow esc, address creator_) {
        token = token_; pairToken = pair; isNativeQuote = pair == address(0); escrow = esc; creator = creator_;
        feeBps = fee; creatorTaxBps = tax; graduationThreshold = threshold; quoteReserve = phantom;
    }
    /// Call once after minting the whole supply to this contract.
    function seed() external {
        uint256 supply = token.balanceOf(address(this));
        tokenReserve = supply;
        reservedTokens = supply * quoteReserve / (quoteReserve + graduationThreshold);
        sellableTokens = supply - reservedTokens;
    }
    function getReserves() external view returns (uint256, uint256) { return (quoteReserve, tokenReserve); }
    function currentSnipeTaxBps(address) external pure returns (uint256) { return 0; }
    function readyToGraduate() public view returns (bool) { return sellableTokens == 0; }
    function graduate() external { require(readyToGraduate()); graduated = true; }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut) {
        if (graduated || readyToGraduate()) revert Graduated();
        if (isNativeQuote) { if (msg.value != quoteIn) revert BadValue(); }
        else IERC20(pairToken).transferFrom(msg.sender, address(this), quoteIn);
        uint256 spent = quoteIn;
        tokensOut = PonsMath.quoteBuy(quoteIn, quoteReserve, tokenReserve, feeBps, creatorTaxBps, 0, type(uint256).max);
        if (tokensOut > sellableTokens) {
            tokensOut = sellableTokens;
            uint256 net = PonsMath.amountIn(tokensOut, quoteReserve, tokenReserve);
            spent = (net * PonsMath.BPS + (PonsMath.BPS - feeBps - creatorTaxBps) - 1) / (PonsMath.BPS - feeBps - creatorTaxBps);
            if (spent > quoteIn) spent = quoteIn;
        }
        // minTokensOut bounds the rate, not the quantity (docs)
        if (tokensOut * quoteIn < minTokensOut * spent) revert Slippage();
        uint256 fee = spent * feeBps / PonsMath.BPS; uint256 tax = spent * creatorTaxBps / PonsMath.BPS;
        uint256 net_ = spent - fee - tax;
        quoteReserve += net_; realQuoteReserve += net_; tokenReserve -= tokensOut; sellableTokens -= tokensOut;
        _credit(fee + tax);
        token.transfer(recipient, tokensOut);
        if (spent < quoteIn) _push(msg.sender, quoteIn - spent);
    }
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut) {
        if (graduated || readyToGraduate()) revert SellsClosed();
        token.transferFrom(msg.sender, address(this), tokensIn);
        uint256 gross = PonsMath.amountOut(tokensIn, tokenReserve, quoteReserve);
        uint256 fee = gross * feeBps / PonsMath.BPS; uint256 tax = gross * creatorTaxBps / PonsMath.BPS;
        quoteOut = gross - fee - tax;
        if (quoteOut < minQuoteOut) revert Slippage();
        quoteReserve -= gross; realQuoteReserve -= gross; tokenReserve += tokensIn; sellableTokens += tokensIn;
        _credit(fee + tax);
        _push(recipient, quoteOut);
    }
    /// test helper: a wallet-less market move (someone else trades)
    function marketBuy(uint256 quoteIn) external payable { this.buy{value: msg.value}(quoteIn, 0, msg.sender); }

    function _credit(uint256 amt) internal {
        if (amt == 0) return;
        if (isNativeQuote) escrow.credit{value: amt}(creator);
        else { IERC20(pairToken).approve(address(escrow), amt); escrow.creditToken(creator, pairToken, amt); }
    }
    function _push(address to, uint256 amt) internal {
        if (amt == 0) return;
        if (isNativeQuote) { (bool ok,) = to.call{value: amt}(""); require(ok); } else IERC20(pairToken).transfer(to, amt);
    }
    receive() external payable {}
}
```

**Step 2: Test the mock against the docs**

`MockCurve.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEscrow} from "./mocks/MockEscrow.sol";
import {MockCurve} from "./mocks/MockCurve.sol";
import {PonsMath} from "../src/libraries/PonsMath.sol";

contract MockCurveTest is Test {
    MockERC20 tok; MockEscrow esc; MockCurve curve; address creator = makeAddr("creator"); address bob = makeAddr("bob");
    function setUp() public {
        tok = new MockERC20("Meme", "MEME", 18); esc = new MockEscrow();
        curve = new MockCurve(tok, address(0), 1.68 ether, 4.2 ether, 100, 200, esc, creator);
        tok.mint(address(curve), 1e9 ether); curve.seed();
        vm.deal(bob, 100 ether);
    }
    function test_seed_splitsSupplyLikePons() public view {
        assertApproxEqRel(curve.sellableTokens(), 714_285_714 ether, 1e12);
        assertApproxEqRel(curve.reservedTokens(), 285_714_285 ether, 1e12);
    }
    function test_buy_creditsCreatorFeeAndTax() public {
        vm.prank(bob); curve.buy{value: 1 ether}(1 ether, 0, bob);
        assertEq(esc.balanceOf(creator), 0.03 ether);
        assertEq(curve.realQuoteReserve(), 0.97 ether);
        assertEq(tok.balanceOf(bob), PonsMath.amountOut(0.97 ether, 1.68 ether, 1e9 ether));
    }
    function test_lastBuy_clampsRefundsAndClosesSells() public {
        vm.prank(bob); curve.buy{value: 10 ether}(10 ether, 0, bob);
        assertEq(curve.sellableTokens(), 0); assertTrue(curve.readyToGraduate());
        assertApproxEqRel(curve.realQuoteReserve(), 4.2 ether, 1e12);
        assertGt(bob.balance, 90 ether); // refunded the excess
        vm.prank(bob); tok.approve(address(curve), 1 ether);
        vm.prank(bob); vm.expectRevert(MockCurve.SellsClosed.selector); curve.sell(1 ether, 0, bob);
    }
    function test_sell_feesOffOutput() public {
        vm.prank(bob); curve.buy{value: 1 ether}(1 ether, 0, bob);
        uint256 bal = tok.balanceOf(bob);
        (uint256 q, uint256 t) = curve.getReserves();
        uint256 expect = PonsMath.quoteSell(bal, q, t, 100, 200);
        vm.startPrank(bob); tok.approve(address(curve), bal); uint256 got = curve.sell(bal, 0, bob); vm.stopPrank();
        assertEq(got, expect);
    }
}
```

**Step 3: Run**

Run: `cd contracts && forge test --match-contract MockCurveTest -vv`
Expected: `4 passed`.

**Step 4: Commit**

```bash
git add contracts/test && git commit -m "test: faithful pons curve, escrow and ERC20 mocks"
```

---

### Task 5: FuelTank and TankFactory

**Files:**
- Create: `contracts/src/FuelTank.sol`, `contracts/src/TankFactory.sol`
- Test: `contracts/test/FuelTank.t.sol`

**Step 1: Failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEscrow} from "./mocks/MockEscrow.sol";
import {MockCurve} from "./mocks/MockCurve.sol";
import {MockPonsFactory} from "./mocks/MockPonsFactory.sol";
import {FuelTank} from "../src/FuelTank.sol";
import {TankFactory} from "../src/TankFactory.sol";

contract FuelTankTest is Test {
    MockERC20 tok; MockEscrow esc; MockCurve curve; MockPonsFactory pons; TankFactory tanks;
    address booster = makeAddr("booster"); address graveyard = makeAddr("graveyard"); address bob = makeAddr("bob");

    function setUp() public {
        tok = new MockERC20("Meme", "MEME", 18); esc = new MockEscrow(); pons = new MockPonsFactory();
        tanks = new TankFactory(pons, esc);
        tanks.wire(booster, graveyard);
        // the tank address is known before it exists: register it as creator fee recipient
        address predicted = tanks.predictTank(address(tok));
        curve = new MockCurve(tok, address(0), 1.68 ether, 4.2 ether, 100, 200, esc, predicted);
        tok.mint(address(curve), 1e9 ether); curve.seed();
        pons.register(address(tok), address(curve), address(0), 4.2 ether, 200, 200);
        vm.deal(bob, 10 ether);
    }
    function test_createTank_isDeterministicAndUnique() public {
        address t = tanks.createTank(address(tok));
        assertEq(t, tanks.predictTank(address(tok)));
        assertEq(tanks.tankOf(address(tok)), t);
        vm.expectRevert(TankFactory.Exists.selector); tanks.createTank(address(tok));
    }
    function test_createTank_rejectsNonPonsToken() public {
        vm.expectRevert(TankFactory.NotPons.selector); tanks.createTank(address(0xBEEF));
    }
    function test_refuel_pullsQuoteAndForwardsMeme() public {
        FuelTank tank = FuelTank(payable(tanks.createTank(address(tok))));
        vm.prank(bob); curve.buy{value: 1 ether}(1 ether, 0, bob);           // 0.03 ETH to tank in escrow
        tok.mint(address(this), 5 ether); tok.approve(address(esc), 5 ether);
        esc.creditToken(address(tank), address(tok), 5 ether);              // meme-side income
        (uint256 q, uint256 m) = tank.refuel();
        assertEq(q, 0.03 ether); assertEq(m, 5 ether);
        assertEq(tank.available(), 0.03 ether);
        assertEq(tok.balanceOf(graveyard), 5 ether);
    }
    function test_lendRepay_onlyBooster() public {
        FuelTank tank = FuelTank(payable(tanks.createTank(address(tok))));
        vm.deal(address(tank), 1 ether);
        vm.expectRevert(FuelTank.NotBooster.selector); tank.lend(0.5 ether);
        vm.prank(booster); tank.lend(0.5 ether);
        assertEq(tank.lent(), 0.5 ether); assertEq(booster.balance, 0.5 ether);
        vm.prank(booster); tank.repay{value: 0.51 ether}(0.5 ether, 0.01 ether);
        assertEq(tank.lent(), 0); assertEq(tank.feesEarned(), 0.01 ether); assertEq(tank.available(), 1.01 ether);
    }
    function test_drain_onlyGraveyard() public {
        FuelTank tank = FuelTank(payable(tanks.createTank(address(tok))));
        vm.deal(address(tank), 1 ether);
        vm.expectRevert(FuelTank.NotGraveyard.selector); tank.drain();
        vm.prank(graveyard); uint256 got = tank.drain();
        assertEq(got, 1 ether); assertEq(graveyard.balance, 1 ether);
    }
}
```

Also create `contracts/test/mocks/MockPonsFactory.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IPonsFactory} from "../../src/interfaces/IPonsFactory.sol";

contract MockPonsFactory is IPonsFactory {
    mapping(address => LaunchedToken) internal launches;
    function register(address token, address curve, address pair, uint256 threshold, int24 tickSpacing, uint16 taxBps) external {
        LaunchedToken memory L; L.token = token; L.curve = curve; L.pairToken = pair; L.graduationThreshold = threshold;
        L.tickSpacing = tickSpacing; L.creatorTaxBps = taxBps; L.exists = true; launches[token] = L;
    }
    function setPhase(address token, uint8 phase) external { launches[token].phase = phase; }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory) { return launches[token]; }
    function getLaunchFeePolicy(address) external pure returns (FeePolicy memory p) { p.protocolFeeShareBps = 3000; p.buybackBurnBps = 5000; p.hookFeeBps = 100; p.maxInternalPriceImpactBps = 300; }
    function transferCreatorFeeRecipient(address, address) external {}
    function canLaunch(address) external pure returns (bool) { return true; }
}
```

**Step 2: Run, expect failure**

Run: `cd contracts && forge test --match-contract FuelTankTest`
Expected: compile error, `FuelTank`/`TankFactory` missing.

**Step 3: Implement**

`FuelTank.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFeeEscrow} from "./interfaces/IFeeEscrow.sol";

/// One per pons token. Meant to be that token's creatorFeeRecipient. Holds the quote asset
/// (native ETH or a stock token) and lends it to the Booster. Meme-token income is not
/// lending capital and is forwarded to the Graveyard.
contract FuelTank {
    using SafeERC20 for IERC20;
    error AlreadyInitialized(); error NotBooster(); error NotGraveyard(); error PushFailed();

    event Refueled(uint256 quoteClaimed, uint256 memeForwarded);
    event Lent(uint256 amount); event Repaid(uint256 principal, uint256 fee); event Drained(uint256 amount);

    address public token; address public quote; // address(0) = native
    IFeeEscrow public escrow; address public booster; address public graveyard;
    uint64 public createdAt; bool private _init;
    uint256 public lent; uint256 public feesEarned;

    function initialize(address token_, address quote_, IFeeEscrow escrow_, address booster_, address graveyard_) external {
        if (_init) revert AlreadyInitialized(); _init = true;
        token = token_; quote = quote_; escrow = escrow_; booster = booster_; graveyard = graveyard_;
        createdAt = uint64(block.timestamp);
    }
    receive() external payable {}

    /// Permissionless. Pulls what the escrow holds for this tank.
    function refuel() external returns (uint256 quoteClaimed, uint256 memeForwarded) {
        if (quote == address(0)) { quoteClaimed = escrow.balanceOf(address(this)); if (quoteClaimed > 0) escrow.claim(); }
        else { quoteClaimed = escrow.balanceOfToken(address(this), quote); if (quoteClaimed > 0) escrow.claimToken(quote); }
        uint256 m = escrow.balanceOfToken(address(this), token); if (m > 0) escrow.claimToken(token);
        memeForwarded = IERC20(token).balanceOf(address(this));
        if (memeForwarded > 0) IERC20(token).safeTransfer(graveyard, memeForwarded);
        emit Refueled(quoteClaimed, memeForwarded);
    }
    function available() public view returns (uint256) {
        return quote == address(0) ? address(this).balance : IERC20(quote).balanceOf(address(this));
    }
    function lend(uint256 amount) external {
        if (msg.sender != booster) revert NotBooster();
        lent += amount; _push(booster, amount); emit Lent(amount);
    }
    /// ERC20 quote: transfer first, then call. Native: send with the call.
    function repay(uint256 principal, uint256 fee) external payable {
        if (msg.sender != booster) revert NotBooster();
        lent -= principal; feesEarned += fee; emit Repaid(principal, fee);
    }
    function drain() external returns (uint256 amount) {
        if (msg.sender != graveyard) revert NotGraveyard();
        amount = available(); _push(graveyard, amount); emit Drained(amount);
    }
    function _push(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (quote == address(0)) { (bool ok,) = to.call{value: amount}(""); if (!ok) revert PushFailed(); }
        else IERC20(quote).safeTransfer(to, amount);
    }
}
```

`TankFactory.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IPonsFactory} from "./interfaces/IPonsFactory.sol";
import {IFeeEscrow} from "./interfaces/IFeeEscrow.sol";
import {FuelTank} from "./FuelTank.sol";

contract TankFactory {
    error Exists(); error NotPons(); error Wired(); error NotDeployer();
    event TankCreated(address indexed token, address indexed tank, address quote);

    IPonsFactory public immutable pons; IFeeEscrow public immutable escrow; address public immutable implementation;
    address private immutable deployer; address public booster; address public graveyard;
    mapping(address => address) public tankOf;

    constructor(IPonsFactory pons_, IFeeEscrow escrow_) { pons = pons_; escrow = escrow_; implementation = address(new FuelTank()); deployer = msg.sender; }
    /// One-shot, breaks the deploy cycle (Booster and Graveyard need this factory's address).
    function wire(address booster_, address graveyard_) external {
        if (msg.sender != deployer) revert NotDeployer(); if (booster != address(0)) revert Wired();
        booster = booster_; graveyard = graveyard_;
    }
    function predictTank(address token) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, bytes32(uint256(uint160(token))), address(this));
    }
    /// Permissionless. A creator can point fees at predictTank(token) before anyone deploys it.
    function createTank(address token) external returns (address tank) {
        if (tankOf[token] != address(0)) revert Exists();
        IPonsFactory.LaunchedToken memory L = pons.getLaunchedToken(token);
        if (!L.exists) revert NotPons();
        tank = Clones.cloneDeterministic(implementation, bytes32(uint256(uint160(token))));
        FuelTank(payable(tank)).initialize(token, L.pairToken, escrow, booster, graveyard);
        tankOf[token] = tank; emit TankCreated(token, tank, L.pairToken);
    }
}
```

**Step 4: Run**

Run: `cd contracts && forge test --match-contract FuelTankTest -vv`
Expected: `5 passed`.

**Step 5: Commit**

```bash
git add contracts/src/FuelTank.sol contracts/src/TankFactory.sol contracts/test && git commit -m "feat: FuelTank clones and TankFactory with predictable addresses"
```

---

### Task 6: Booster — open on the curve (native quote)

**Files:**
- Create: `contracts/src/Booster.sol`
- Test: `contracts/test/Booster.t.sol`

**Step 1: Failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEscrow} from "./mocks/MockEscrow.sol";
import {MockCurve} from "./mocks/MockCurve.sol";
import {MockPonsFactory} from "./mocks/MockPonsFactory.sol";
import {FuelTank} from "../src/FuelTank.sol";
import {TankFactory} from "../src/TankFactory.sol";
import {Booster} from "../src/Booster.sol";
import {IPoolManager} from "../src/interfaces/IPoolManager.sol";
import {IStateView} from "../src/interfaces/IStateView.sol";
import {PonsMath} from "../src/libraries/PonsMath.sol";

contract BoosterTest is Test {
    MockERC20 tok; MockEscrow esc; MockCurve curve; MockPonsFactory pons; TankFactory tanks; Booster booster; FuelTank tank;
    address graveyard = makeAddr("graveyard"); address alice = makeAddr("alice"); address whale = makeAddr("whale");

    function params() internal pure returns (Booster.Params memory p) {
        p = Booster.Params({maxImpactBps: 500, maintenanceBps: 1000, borrowFeeBpsPerDay: 10, openFeeBps: 50,
            liqPenaltyBps: 2000, keeperShareBps: 5000, curveMaxLev: 2, lev3DepthX: 5, lev5DepthX: 12});
    }
    function setUp() public virtual {
        tok = new MockERC20("Meme", "MEME", 18); esc = new MockEscrow(); pons = new MockPonsFactory();
        tanks = new TankFactory(pons, esc);
        booster = new Booster(tanks, pons, IPoolManager(address(0)), IStateView(address(0)), address(0xh00c), params());
        tanks.wire(address(booster), graveyard);
        booster.wire(graveyard);
        address predicted = tanks.predictTank(address(tok));
        curve = new MockCurve(tok, address(0), 1.68 ether, 4.2 ether, 100, 200, esc, predicted);
        tok.mint(address(curve), 1e9 ether); curve.seed();
        pons.register(address(tok), address(curve), address(0), 4.2 ether, 200, 200);
        tank = FuelTank(payable(tanks.createTank(address(tok))));
        vm.deal(address(tank), 1 ether);          // pretend fees accrued
        vm.deal(alice, 10 ether); vm.deal(whale, 100 ether);
    }
    function test_capacity_isMinOfImpactAndFuel() public view {
        // curve quote reserve 1.68: impact cap = 1.68*0.05/2 = 0.042 ETH notional; tank has 1 ETH
        assertEq(booster.maxNotional(address(tok)), 0.042 ether);
    }
    function test_open_2x_onCurve() public {
        uint256 margin = 0.02 ether;
        vm.prank(alice); uint256 id = booster.open{value: margin}(address(tok), margin, 2, 0);
        (address owner, address token, uint8 lev,, uint128 tokens, uint128 debt) = booster.positions(id);
        assertEq(owner, alice); assertEq(token, address(tok)); assertEq(lev, 2);
        // borrowed 0.02, open fee 0.5% of borrow = 0.0001 stays in tank as fee
        assertEq(debt, 0.02 ether);
        assertEq(tank.lent(), 0.02 ether); assertEq(tank.feesEarned(), 0.0001 ether);
        assertEq(tok.balanceOf(address(booster)), tokens);
        assertEq(tokens, PonsMath.quoteBuy(0.04 ether - 0.0001 ether, 1.68 ether, 1e9 ether, 100, 200, 0, type(uint256).max));
        assertEq(booster.openInterest(address(tok)), 0.02 ether);
    }
    function test_open_rejectsLeverageAboveCurveMax() public {
        vm.prank(alice); vm.expectRevert(Booster.LeverageTooHigh.selector);
        booster.open{value: 0.01 ether}(address(tok), 0.01 ether, 3, 0);
    }
    function test_open_rejectsImpactAboveCap() public {
        vm.prank(alice); vm.expectRevert(Booster.ExceedsCapacity.selector);
        booster.open{value: 0.03 ether}(address(tok), 0.03 ether, 2, 0);   // 0.06 notional > 0.042
    }
    function test_open_rejectsWhenTankIsDry() public {
        vm.deal(address(tank), 0.005 ether);
        vm.prank(alice); vm.expectRevert(Booster.ExceedsCapacity.selector);
        booster.open{value: 0.02 ether}(address(tok), 0.02 ether, 2, 0);
    }
    function test_open_rejectsBadValue() public {
        vm.prank(alice); vm.expectRevert(Booster.BadValue.selector);
        booster.open{value: 0.01 ether}(address(tok), 0.02 ether, 2, 0);
    }
}
```

**Step 2: Run, expect failure**

Run: `cd contracts && forge test --match-contract BoosterTest`
Expected: compile error, `Booster` missing.

**Step 3: Implement the skeleton with `open`, capacity and views**

`Booster.sol` (this task's version; later tasks add close, liquidate, ERC20 quote and the pool venue):
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPonsCurve} from "./interfaces/IPonsCurve.sol";
import {IPonsFactory} from "./interfaces/IPonsFactory.sol";
import {IPoolManager, IUnlockCallback, PoolKey, SwapParams, V4} from "./interfaces/IPoolManager.sol";
import {IStateView} from "./interfaces/IStateView.sol";
import {PonsMath} from "./libraries/PonsMath.sol";
import {TankFactory} from "./TankFactory.sol";
import {FuelTank} from "./FuelTank.sol";

interface IGraveyardView { function isDead(address token) external view returns (bool); }

/// Physical leverage on pons launches. Borrows quote from the token's FuelTank, buys real tokens
/// on the live venue, custodies them, marks at realizable sell value, sells to close or liquidate.
contract Booster is ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    uint256 internal constant BPS = 10_000;

    struct Params {
        uint16 maxImpactBps; uint16 maintenanceBps; uint16 borrowFeeBpsPerDay; uint16 openFeeBps;
        uint16 liqPenaltyBps; uint16 keeperShareBps; uint8 curveMaxLev; uint16 lev3DepthX; uint16 lev5DepthX;
    }
    struct Position { address owner; address token; uint8 lev; uint40 openedAt; uint128 tokens; uint128 debt; }
    enum Venue { Curve, Pool }

    error NoTank(); error Dead(); error LeverageTooHigh(); error ExceedsCapacity(); error BadValue();
    error VenueClosed(); error NotOwner(); error NoPosition(); error Healthy(); error Wired(); error NotDeployer(); error NotPoolManager();

    event Opened(uint256 indexed id, address indexed owner, address indexed token, uint8 lev, uint256 margin, uint256 debt, uint256 tokens, Venue venue);
    event Closed(uint256 indexed id, uint256 quoteOut, uint256 repaid, uint256 fee, uint256 toOwner);
    event Liquidated(uint256 indexed id, address indexed keeper, uint256 quoteOut, uint256 repaid, uint256 penalty, uint256 toOwner, uint256 shortfall);

    TankFactory public immutable tanks; IPonsFactory public immutable pons; IPoolManager public immutable pm;
    IStateView public immutable stateView; address public immutable hook; Params public params;
    address private immutable deployer; IGraveyardView public graveyard;

    mapping(uint256 => Position) public positions; uint256 public nextId = 1;
    mapping(address => uint256) public openInterest;

    constructor(TankFactory tanks_, IPonsFactory pons_, IPoolManager pm_, IStateView sv_, address hook_, Params memory p) {
        tanks = tanks_; pons = pons_; pm = pm_; stateView = sv_; hook = hook_; params = p; deployer = msg.sender;
    }
    function wire(address graveyard_) external {
        if (msg.sender != deployer) revert NotDeployer(); if (address(graveyard) != address(0)) revert Wired();
        graveyard = IGraveyardView(graveyard_);
    }
    receive() external payable {}

    // ───────────────────────── views ─────────────────────────

    function venueOf(address token) public view returns (Venue) {
        IPonsCurve c = IPonsCurve(pons.getLaunchedToken(token).curve);
        if (c.graduated()) return Venue.Pool;
        if (c.readyToGraduate()) revert VenueClosed();
        return Venue.Curve;
    }
    /// Quote-side depth of the live venue (the constant-product reserve the next trade prices against).
    function quoteDepth(address token) public view returns (uint256) {
        IPonsFactory.LaunchedToken memory L = pons.getLaunchedToken(token);
        if (venueOf(token) == Venue.Curve) { (uint256 q,) = IPonsCurve(L.curve).getReserves(); return q; }
        (uint256 rq,) = _poolReserves(L);
        return rq;
    }
    function maxLeverage(address token) public view returns (uint8) {
        IPonsFactory.LaunchedToken memory L = pons.getLaunchedToken(token);
        if (venueOf(token) == Venue.Curve) return params.curveMaxLev;
        uint256 d = quoteDepth(token);
        if (d >= L.graduationThreshold * params.lev5DepthX) return 5;
        if (d >= L.graduationThreshold * params.lev3DepthX) return 3;
        return 2;
    }
    /// Largest notional (margin + borrow) a new position may buy right now.
    function maxNotional(address token) public view returns (uint256) {
        address tank = tanks.tankOf(token); if (tank == address(0)) return 0;
        uint256 byImpact = PonsMath.maxBuyForImpact(quoteDepth(token), params.maxImpactBps);
        return byImpact; // the fuel constraint applies to the borrow, checked in open()
    }
    function realizable(uint256 id) public view returns (uint256) {
        Position memory p = positions[id]; if (p.owner == address(0)) return 0;
        return _realizable(pons.getLaunchedToken(p.token), p.tokens);
    }
    /// realizable / debt in bps. type(uint256).max when no debt.
    function health(uint256 id) public view returns (uint256) {
        Position memory p = positions[id]; if (p.debt == 0) return type(uint256).max;
        return realizable(id) * BPS / p.debt;
    }
    function borrowFee(uint256 id) public view returns (uint256) {
        Position memory p = positions[id];
        return uint256(p.debt) * params.borrowFeeBpsPerDay * (block.timestamp - p.openedAt) / 1 days / BPS;
    }

    // ───────────────────────── open ─────────────────────────

    function open(address token, uint256 margin, uint8 lev, uint256 minTokensOut) external payable nonReentrant returns (uint256 id) {
        IPonsFactory.LaunchedToken memory L = pons.getLaunchedToken(token);
        address tankAddr = tanks.tankOf(token); if (tankAddr == address(0)) revert NoTank();
        if (address(graveyard) != address(0) && graveyard.isDead(token)) revert Dead();
        if (lev < 2 || lev > maxLeverage(token)) revert LeverageTooHigh();
        Venue v = venueOf(token);

        uint256 borrow = margin * (lev - 1);
        uint256 notional = margin + borrow;
        if (notional > maxNotional(token)) revert ExceedsCapacity();
        FuelTank tank = FuelTank(payable(tankAddr));
        if (borrow > tank.available()) revert ExceedsCapacity();

        _pull(L.pairToken, margin);
        tank.lend(borrow);
        uint256 openFee = borrow * params.openFeeBps / BPS;
        _repayTank(tank, L.pairToken, 0, openFee);       // fee back to the tank immediately
        uint256 tokensOut = _buy(L, v, notional - openFee, minTokensOut);

        id = nextId++;
        positions[id] = Position(msg.sender, token, lev, uint40(block.timestamp), uint128(tokensOut), uint128(borrow));
        openInterest[token] += borrow;
        emit Opened(id, msg.sender, token, lev, margin, borrow, tokensOut, v);
    }

    // ───────────────────── venue plumbing ─────────────────────

    function _buy(IPonsFactory.LaunchedToken memory L, Venue v, uint256 quoteIn, uint256 minOut) internal returns (uint256 out) {
        if (v == Venue.Curve) {
            IPonsCurve c = IPonsCurve(L.curve);
            if (L.pairToken == address(0)) return c.buy{value: quoteIn}(quoteIn, minOut, address(this));
            IERC20(L.pairToken).forceApprove(L.curve, quoteIn);
            return c.buy(quoteIn, minOut, address(this));
        }
        out = _poolSwap(L, true, quoteIn);
        if (out < minOut) revert BadValue();
    }
    function _sell(IPonsFactory.LaunchedToken memory L, Venue v, uint256 tokensIn, uint256 minOut) internal returns (uint256 out) {
        if (v == Venue.Curve) {
            IERC20(L.token).forceApprove(L.curve, tokensIn);
            return IPonsCurve(L.curve).sell(tokensIn, minOut, address(this));
        }
        out = _poolSwap(L, false, tokensIn);
        if (out < minOut) revert BadValue();
    }
    function _realizable(IPonsFactory.LaunchedToken memory L, uint256 tokens) internal view returns (uint256) {
        IPonsCurve c = IPonsCurve(L.curve);
        if (!c.graduated()) {
            (uint256 q, uint256 t) = c.getReserves();
            return PonsMath.quoteSell(tokens, q, t, c.feeBps(), c.creatorTaxBps());
        }
        (uint256 rq, uint256 rt) = _poolReserves(L);
        uint256 gross = PonsMath.amountOut(tokens, rt, rq);
        IPonsFactory.FeePolicy memory fp = pons.getLaunchFeePolicy(L.token);
        return gross - gross * (fp.hookFeeBps + L.creatorTaxBps) / BPS;
    }

    // pool venue: implemented in Task 10 (stubs keep this task compiling)
    function _poolReserves(IPonsFactory.LaunchedToken memory) internal view virtual returns (uint256, uint256) { revert VenueClosed(); }
    function _poolSwap(IPonsFactory.LaunchedToken memory, bool, uint256) internal virtual returns (uint256) { revert VenueClosed(); }
    function unlockCallback(bytes calldata) external virtual returns (bytes memory) { revert NotPoolManager(); }

    // ───────────────────── money plumbing ─────────────────────

    function _pull(address quote, uint256 amount) internal {
        if (quote == address(0)) { if (msg.value != amount) revert BadValue(); }
        else { if (msg.value != 0) revert BadValue(); IERC20(quote).safeTransferFrom(msg.sender, address(this), amount); }
    }
    function _push(address quote, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (quote == address(0)) { (bool ok,) = to.call{value: amount}(""); if (!ok) revert BadValue(); }
        else IERC20(quote).safeTransfer(to, amount);
    }
    function _repayTank(FuelTank tank, address quote, uint256 principal, uint256 fee) internal {
        uint256 total = principal + fee;
        if (quote == address(0)) tank.repay{value: total}(principal, fee);
        else { if (total > 0) IERC20(quote).safeTransfer(address(tank), total); tank.repay(principal, fee); }
    }
}
```

**Step 4: Run**

Run: `cd contracts && forge test --match-contract BoosterTest -vv`
Expected: `6 passed`. If `test_open_2x_onCurve` disagrees on `tokens`, check the order: the open fee is paid to the tank *before* the buy, so the buy spends `notional - openFee`.

**Step 5: Commit**

```bash
git add contracts/src/Booster.sol contracts/test/Booster.t.sol && git commit -m "feat: Booster open on the curve with impact and fuel caps"
```

---

### Task 7: Booster — close

**Files:**
- Modify: `contracts/src/Booster.sol`
- Test: `contracts/test/Booster.t.sol`

**Step 1: Failing tests (append to `BoosterTest`)**

```solidity
    function _open(uint256 margin) internal returns (uint256 id) {
        vm.prank(alice); id = booster.open{value: margin}(address(tok), margin, 2, 0);
    }
    function test_close_afterPump_paysOwnerAndTank() public {
        uint256 id = _open(0.02 ether);
        vm.prank(whale); curve.buy{value: 0.5 ether}(0.5 ether, 0, whale);     // price up
        vm.warp(block.timestamp + 2 days);                                      // 0.2% borrow fee
        uint256 before = alice.balance;
        uint256 expectOut = booster.realizable(id);
        vm.prank(alice); booster.close(id, 0);
        uint256 fee = 0.02 ether * 10 * 2 / 10_000;
        assertEq(alice.balance - before, expectOut - 0.02 ether - fee);
        assertEq(tank.lent(), 0); assertEq(tank.feesEarned(), 0.0001 ether + fee);
        (address owner,,,,,) = booster.positions(id); assertEq(owner, address(0));
        assertEq(booster.openInterest(address(tok)), 0);
    }
    function test_close_underwater_tankEatsShortfall() public {
        uint256 id = _open(0.02 ether);
        // no move: round-trip fees + own impact put a 2x under water on a realizable mark
        uint256 out = booster.realizable(id);
        assertLt(out, 0.04 ether); assertGt(out, 0.02 ether);
        uint256 before = alice.balance;
        vm.prank(alice); booster.close(id, 0);
        assertEq(alice.balance - before, out - 0.02 ether); // owner gets what is left after debt
    }
    function test_close_onlyOwner() public {
        uint256 id = _open(0.02 ether);
        vm.prank(whale); vm.expectRevert(Booster.NotOwner.selector); booster.close(id, 0);
    }
```

**Step 2: Run, expect failure**

Run: `cd contracts && forge test --match-contract BoosterTest --match-test close`
Expected: compile error, `close` missing.

**Step 3: Implement (add to Booster after `open`)**

```solidity
    // ───────────────────────── close ─────────────────────────

    function close(uint256 id, uint256 minQuoteOut) external nonReentrant {
        Position memory p = positions[id];
        if (p.owner == address(0)) revert NoPosition(); if (p.owner != msg.sender) revert NotOwner();
        (uint256 quoteOut, uint256 repaid, uint256 fee, uint256 toOwner) = _unwind(id, p, minQuoteOut);
        emit Closed(id, quoteOut, repaid, fee, toOwner);
    }

    /// Sells everything, repays the tank first (principal, then fee), returns the rest.
    /// If proceeds do not cover the debt the tank absorbs the shortfall.
    function _unwind(uint256 id, Position memory p, uint256 minQuoteOut)
        internal returns (uint256 quoteOut, uint256 repaid, uint256 fee, uint256 remainder)
    {
        IPonsFactory.LaunchedToken memory L = pons.getLaunchedToken(p.token);
        Venue v = venueOf(p.token);
        delete positions[id]; openInterest[p.token] -= p.debt;
        quoteOut = _sell(L, v, p.tokens, minQuoteOut);
        FuelTank tank = FuelTank(payable(tanks.tankOf(p.token)));
        uint256 owedFee = borrowFeeFor(p);
        repaid = Math.min(quoteOut, p.debt);
        fee = Math.min(quoteOut - repaid, owedFee);
        _repayTank(tank, L.pairToken, p.debt, fee);            // principal accounting always clears the debt
        remainder = quoteOut - repaid - fee;
        _push(L.pairToken, p.owner, remainder);
    }
    function borrowFeeFor(Position memory p) internal view returns (uint256) {
        return uint256(p.debt) * params.borrowFeeBpsPerDay * (block.timestamp - p.openedAt) / 1 days / BPS;
    }
```

`_repayTank` sends `principal + fee` of value; when `quoteOut < p.debt` the Booster would not have enough. Fix `_repayTank` usage in `_unwind`: send `repaid + fee` but account `p.debt` principal so `tank.lent` clears:

```solidity
        if (L.pairToken == address(0)) tank.repay{value: repaid + fee}(p.debt, fee);
        else { if (repaid + fee > 0) IERC20(L.pairToken).safeTransfer(address(tank), repaid + fee); tank.repay(p.debt, fee); }
```
Use this instead of the `_repayTank(...)` line inside `_unwind`. Also make `borrowFee(id)` call `borrowFeeFor(positions[id])`.

**Step 4: Run**

Run: `cd contracts && forge test --match-contract BoosterTest -vv`
Expected: `9 passed`.

**Step 5: Commit**

```bash
git add contracts && git commit -m "feat: Booster close with borrow fee and shortfall absorption"
```

---

### Task 8: Booster — liquidate

**Files:**
- Modify: `contracts/src/Booster.sol`
- Test: `contracts/test/Booster.t.sol`

**Step 1: Failing tests**

```solidity
    function test_liquidate_revertsWhileHealthy() public {
        uint256 id = _open(0.02 ether);
        vm.prank(whale); curve.buy{value: 0.5 ether}(0.5 ether, 0, whale);
        assertGt(booster.health(id), 11_000);
        vm.prank(whale); vm.expectRevert(Booster.Healthy.selector); booster.liquidate(id, 0);
    }
    function test_liquidate_afterDump_splitsSurplus() public {
        // whale pumps first so alice has room, alice opens, whale dumps
        vm.prank(whale); curve.buy{value: 0.5 ether}(0.5 ether, 0, whale);
        vm.deal(address(tank), 1 ether);
        uint256 margin = 0.02 ether; uint256 id = _open(margin);
        uint256 wbal = tok.balanceOf(whale);
        vm.startPrank(whale); tok.approve(address(curve), wbal); curve.sell(wbal, 0, whale); vm.stopPrank();
        uint256 h = booster.health(id); assertLt(h, 11_000);
        uint256 out = booster.realizable(id);
        address keeper = makeAddr("keeper");
        uint256 a0 = alice.balance; uint256 t0 = tank.available(); uint256 k0 = keeper.balance;
        vm.prank(keeper); booster.liquidate(id, 0);
        if (out > margin) { /* unlikely here */ }
        uint256 debt = margin; // 2x
        if (out > debt) {
            uint256 surplus = out - debt; uint256 penalty = surplus * 2000 / 10_000; uint256 toKeeper = penalty * 5000 / 10_000;
            assertEq(keeper.balance - k0, toKeeper);
            assertEq(alice.balance - a0, surplus - penalty);
            assertEq(tank.available() - t0, debt + (penalty - toKeeper));
        } else {
            assertEq(alice.balance, a0); assertEq(keeper.balance, k0);
            assertEq(tank.available() - t0, out);
        }
        (address owner,,,,,) = booster.positions(id); assertEq(owner, address(0));
    }
```

**Step 2: Run, expect failure**

Run: `cd contracts && forge test --match-contract BoosterTest --match-test liquidate`
Expected: compile error, `liquidate` missing.

**Step 3: Implement**

```solidity
    // ───────────────────────── liquidate ─────────────────────────

    /// Permissionless. Allowed when realizable value is below debt × (1 + maintenance).
    /// Surplus over the debt is split: a penalty (shared keeper/tank) and the rest to the owner.
    function liquidate(uint256 id, uint256 minQuoteOut) external nonReentrant {
        Position memory p = positions[id];
        if (p.owner == address(0)) revert NoPosition();
        if (realizable(id) * BPS >= uint256(p.debt) * (BPS + params.maintenanceBps)) revert Healthy();
        IPonsFactory.LaunchedToken memory L = pons.getLaunchedToken(p.token);
        Venue v = venueOf(p.token);
        delete positions[id]; openInterest[p.token] -= p.debt;
        uint256 quoteOut = _sell(L, v, p.tokens, minQuoteOut);
        FuelTank tank = FuelTank(payable(tanks.tankOf(p.token)));
        uint256 repaid = Math.min(quoteOut, p.debt);
        uint256 surplus = quoteOut - repaid;
        uint256 penalty = surplus * params.liqPenaltyBps / BPS;
        uint256 toKeeper = penalty * params.keeperShareBps / BPS;
        uint256 toTankFee = penalty - toKeeper;
        if (L.pairToken == address(0)) tank.repay{value: repaid + toTankFee}(p.debt, toTankFee);
        else { IERC20(L.pairToken).safeTransfer(address(tank), repaid + toTankFee); tank.repay(p.debt, toTankFee); }
        _push(L.pairToken, msg.sender, toKeeper);
        _push(L.pairToken, p.owner, surplus - penalty);
        emit Liquidated(id, msg.sender, quoteOut, repaid, penalty, surplus - penalty, p.debt - repaid);
    }
```

**Step 4: Run**

Run: `cd contracts && forge test --match-contract BoosterTest -vv`
Expected: `11 passed`.

**Step 5: Commit**

```bash
git add contracts && git commit -m "feat: permissionless liquidation with keeper/tank penalty split"
```

---

### Task 9: ERC20 quote (stock-token-quoted launches) and the graduation boundary

**Files:**
- Create: `contracts/test/BoosterErc20.t.sol`
- Modify: `contracts/test/Booster.t.sol`

**Step 1: Failing tests**

`BoosterErc20.t.sol` — same fixture with an 18-decimal `NVDA` mock as the quote (phantom 16.64, threshold 41.6):
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEscrow} from "./mocks/MockEscrow.sol";
import {MockCurve} from "./mocks/MockCurve.sol";
import {MockPonsFactory} from "./mocks/MockPonsFactory.sol";
import {FuelTank} from "../src/FuelTank.sol";
import {TankFactory} from "../src/TankFactory.sol";
import {Booster} from "../src/Booster.sol";
import {IPoolManager} from "../src/interfaces/IPoolManager.sol";
import {IStateView} from "../src/interfaces/IStateView.sol";

contract BoosterErc20Test is Test {
    MockERC20 tok; MockERC20 nvda; MockEscrow esc; MockCurve curve; MockPonsFactory pons; TankFactory tanks; Booster booster; FuelTank tank;
    address graveyard = makeAddr("graveyard"); address alice = makeAddr("alice");

    function setUp() public {
        tok = new MockERC20("Meme", "MEME", 18); nvda = new MockERC20("NVIDIA Stock Token", "NVDA", 18);
        esc = new MockEscrow(); pons = new MockPonsFactory(); tanks = new TankFactory(pons, esc);
        booster = new Booster(tanks, pons, IPoolManager(address(0)), IStateView(address(0)), address(0),
            Booster.Params(500, 1000, 10, 50, 2000, 5000, 2, 5, 12));
        tanks.wire(address(booster), graveyard); booster.wire(graveyard);
        curve = new MockCurve(tok, address(nvda), 16.64 ether, 41.6 ether, 100, 200, esc, tanks.predictTank(address(tok)));
        tok.mint(address(curve), 1e9 ether); curve.seed();
        pons.register(address(tok), address(curve), address(nvda), 41.6 ether, 200, 200);
        tank = FuelTank(payable(tanks.createTank(address(tok))));
        nvda.mint(address(tank), 10 ether); nvda.mint(alice, 10 ether);
    }
    function test_openAndClose_inStockQuote() public {
        uint256 margin = 0.2 ether; // 0.2 NVDA; impact cap = 16.64*0.025 = 0.416 notional
        vm.startPrank(alice); nvda.approve(address(booster), margin);
        uint256 id = booster.open(address(tok), margin, 2, 0); vm.stopPrank();
        assertEq(tank.lent(), 0.2 ether); assertEq(nvda.balanceOf(address(booster)), 0);
        uint256 out = booster.realizable(id);
        vm.prank(alice); booster.close(id, 0);
        assertEq(nvda.balanceOf(alice), 10 ether - margin + (out - 0.2 ether));
        assertEq(tank.lent(), 0);
    }
    function test_open_rejectsEthWithErc20Quote() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice); nvda.approve(address(booster), 0.2 ether);
        vm.expectRevert(Booster.BadValue.selector); booster.open{value: 0.1 ether}(address(tok), 0.2 ether, 2, 0);
        vm.stopPrank();
    }
}
```

Append to `BoosterTest`:
```solidity
    function test_venueClosed_betweenReadyAndGraduated() public {
        uint256 id = _open(0.02 ether);
        vm.prank(whale); curve.buy{value: 10 ether}(10 ether, 0, whale);   // finishes the curve
        assertTrue(curve.readyToGraduate()); assertFalse(curve.graduated());
        vm.prank(alice); vm.expectRevert(Booster.VenueClosed.selector); booster.close(id, 0);
        vm.expectRevert(Booster.VenueClosed.selector); booster.venueOf(address(tok));
    }
```

**Step 2: Run, expect the ERC20 tests to fail or pass**

Run: `cd contracts && forge test --match-contract "Booster" -vv`
Expected: `test_venueClosed_betweenReadyAndGraduated` passes already (the venue check exists). The ERC20 tests should pass too because `_pull`/`_push` already branch on quote. If `test_openAndClose_inStockQuote` fails on `nvda.balanceOf(booster) == 0`, the open fee transfer to the tank is the culprit: in `open`, the ERC20 branch of `_repayTank` transfers `openFee` from the Booster, which must have pulled `margin` first. It does. Debug with `-vvvv`.

**Step 3: Commit**

```bash
git add contracts/test && git commit -m "test: stock-token quote path and graduation boundary"
```

---

### Task 10: Pool venue (Uniswap v4) with a fork test

**Files:**
- Modify: `contracts/src/Booster.sol` (replace the three stubs)
- Create: `contracts/test/fork/PoolVenue.t.sol`, `contracts/.env.example`

**Step 1: Failing fork test**

`contracts/.env.example`:
```
ROBINHOOD_RPC=https://rpc.mainnet.chain.robinhood.com
```

`PoolVenue.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {Booster} from "../../src/Booster.sol";
import {TankFactory} from "../../src/TankFactory.sol";
import {FuelTank} from "../../src/FuelTank.sol";
import {IPonsFactory} from "../../src/interfaces/IPonsFactory.sol";
import {IFeeEscrow} from "../../src/interfaces/IFeeEscrow.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {IStateView} from "../../src/interfaces/IStateView.sol";

/// Runs only with a fork: forge test --match-contract PoolVenueFork --fork-url $ROBINHOOD_RPC
contract PoolVenueForkTest is Test {
    address constant PONS = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address constant HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant PM = 0x8366a39cc670b4001a1121b8f6a443a643e40951;
    address constant SV = 0xf3334192d15450cdd385c8b70e03f9a6bd9e673b;
    address constant TOKEN = 0x565f864edb37b46800add658c94df82e7ea175fe; // graduated, ETH-quoted, thin

    TankFactory tanks; Booster booster; address alice = makeAddr("alice"); address grave = makeAddr("grave");

    function setUp() public {
        if (block.chainid != 4663) return;
        tanks = new TankFactory(IPonsFactory(PONS), IFeeEscrow(ESCROW));
        booster = new Booster(tanks, IPonsFactory(PONS), IPoolManager(PM), IStateView(SV), HOOK, Booster.Params(500, 1000, 10, 50, 2000, 5000, 2, 5, 12));
        tanks.wire(address(booster), grave); booster.wire(grave);
        address tank = tanks.createTank(TOKEN);
        vm.deal(tank, 1 ether); vm.deal(alice, 1 ether);
    }
    function test_poolDepthAndRoundTrip() public {
        if (block.chainid != 4663) return;
        uint256 depth = booster.quoteDepth(TOKEN);
        assertGt(depth, 0.1 ether); assertLt(depth, 100 ether);
        uint256 cap = booster.maxNotional(TOKEN);
        uint256 margin = cap / 2 - 1;                     // 2x fits under the cap
        vm.prank(alice); uint256 id = booster.open{value: margin}(TOKEN, margin, 2, 0);
        uint256 r = booster.realizable(id);
        assertGt(r, margin);                              // 2x, small impact, ~2% fees: still above debt
        uint256 before = alice.balance;
        vm.prank(alice); booster.close(id, 0);
        assertGt(alice.balance, before);
    }
}
```

**Step 2: Run, expect failure**

Run: `cd contracts && export ROBINHOOD_RPC=https://rpc.mainnet.chain.robinhood.com && forge test --match-contract PoolVenueFork --fork-url $ROBINHOOD_RPC -vv`
Expected: revert `VenueClosed` from the `_poolReserves` stub.

**Step 3: Implement the pool venue (replace the three stubs in Booster)**

```solidity
    // ───────────────────────── pool venue ─────────────────────────

    function _poolKey(IPonsFactory.LaunchedToken memory L) internal view returns (PoolKey memory k, bool quoteIsZero) {
        quoteIsZero = L.pairToken < L.token;               // native quote is address(0): always currency0
        k = PoolKey(quoteIsZero ? L.pairToken : L.token, quoteIsZero ? L.token : L.pairToken, L.poolFee, L.tickSpacing, hook);
    }
    /// Virtual constant-product reserves of the pool at the current price: x = L/√P, y = L·√P.
    /// Exact for the single full-range position pons locks; conservative if others add liquidity in range.
    function _poolReserves(IPonsFactory.LaunchedToken memory L) internal view override returns (uint256 rq, uint256 rt) {
        (PoolKey memory k, bool quoteIsZero) = _poolKey(L);
        bytes32 id = V4.poolId(k);
        (uint160 sqrtP,,,) = stateView.getSlot0(id);
        uint256 liq = stateView.getLiquidity(id);
        uint256 r0 = Math.mulDiv(liq, 1 << 96, sqrtP);
        uint256 r1 = Math.mulDiv(liq, sqrtP, 1 << 96);
        (rq, rt) = quoteIsZero ? (r0, r1) : (r1, r0);
    }
    function _poolSwap(IPonsFactory.LaunchedToken memory L, bool buyToken, uint256 amountIn) internal override returns (uint256 out) {
        (PoolKey memory k, bool quoteIsZero) = _poolKey(L);
        bool zeroForOne = buyToken ? quoteIsZero : !quoteIsZero;
        bytes memory res = pm.unlock(abi.encode(k, zeroForOne, amountIn));
        out = abi.decode(res, (uint256));
    }
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(pm)) revert NotPoolManager();
        (PoolKey memory k, bool zeroForOne, uint256 amountIn) = abi.decode(data, (PoolKey, bool, uint256));
        int256 delta = pm.swap(k, SwapParams(zeroForOne, -int256(amountIn), zeroForOne ? V4.MIN_SQRT_PRICE + 1 : V4.MAX_SQRT_PRICE - 1), "");
        address cIn = zeroForOne ? k.currency0 : k.currency1; address cOut = zeroForOne ? k.currency1 : k.currency0;
        int128 dIn = zeroForOne ? V4.amount0(delta) : V4.amount1(delta);
        int128 dOut = zeroForOne ? V4.amount1(delta) : V4.amount0(delta);
        uint256 owed = uint256(uint128(-dIn)); uint256 got = uint256(uint128(dOut));
        if (cIn == address(0)) pm.settle{value: owed}();
        else { pm.sync(cIn); IERC20(cIn).safeTransfer(address(pm), owed); pm.settle(); }
        pm.take(cOut, address(this), got);
        return abi.encode(got);
    }
```

Remove `virtual` from the stubs' signatures if the compiler complains about `override` without a virtual base (they are in the same contract; simplest is to delete the stubs and keep only these bodies without `override`).

**Step 4: Run both suites**

Run: `cd contracts && forge test -vv` (unit, no network) → Expected: all previous tests pass; fork test is skipped (chainid guard).
Run: `forge test --match-contract PoolVenueFork --fork-url $ROBINHOOD_RPC -vv` → Expected: `1 passed`. If the RPC 429s, add `--fork-retries 5 --fork-retry-backoff 2000`. If the swap reverts inside the hook, print `depth` and `cap` with `-vvvv`; the hook's `maxInternalPriceImpactBps` does not apply to swaps, only to sweeps, so a revert there means the pool key is wrong (check `tickSpacing` from the launch record and that `hooks` is the meme hook).

**Step 5: Commit**

```bash
git add contracts && git commit -m "feat: v4 pool venue for graduated tokens, fork-tested"
```

---

### Task 11: Graveyard

**Files:**
- Create: `contracts/src/Graveyard.sol`
- Test: `contracts/test/Graveyard.t.sol`

Rules (from the design doc's defaults): a token is dead when either (a) it has not graduated, its tank is at least 7 days old and `realQuoteReserve < 1%` of the threshold, or (b) it has graduated and pool quote depth is below `threshold / 20`. Marking requires no open positions. On death the tank is drained into the token's pot; meme tokens the graveyard holds for that token are burned to `0xdead`. Burners have 30 days to burn bags for tickets; afterwards each claims `pot × tickets / totalTickets`. Late fuel can be swept into the pot while the window is open.

**Step 1: Failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEscrow} from "./mocks/MockEscrow.sol";
import {MockCurve} from "./mocks/MockCurve.sol";
import {MockPonsFactory} from "./mocks/MockPonsFactory.sol";
import {FuelTank} from "../src/FuelTank.sol";
import {TankFactory} from "../src/TankFactory.sol";
import {Booster} from "../src/Booster.sol";
import {Graveyard} from "../src/Graveyard.sol";
import {IPoolManager} from "../src/interfaces/IPoolManager.sol";
import {IStateView} from "../src/interfaces/IStateView.sol";

contract GraveyardTest is Test {
    MockERC20 tok; MockEscrow esc; MockCurve curve; MockPonsFactory pons; TankFactory tanks; Booster booster; Graveyard grave; FuelTank tank;
    address alice = makeAddr("alice"); address bob = makeAddr("bob");
    function setUp() public {
        tok = new MockERC20("Meme", "MEME", 18); esc = new MockEscrow(); pons = new MockPonsFactory(); tanks = new TankFactory(pons, esc);
        booster = new Booster(tanks, pons, IPoolManager(address(0)), IStateView(address(0)), address(0), Booster.Params(500, 1000, 10, 50, 2000, 5000, 2, 5, 12));
        grave = new Graveyard(tanks, pons, booster);
        tanks.wire(address(booster), address(grave)); booster.wire(address(grave));
        curve = new MockCurve(tok, address(0), 1.68 ether, 4.2 ether, 100, 200, esc, tanks.predictTank(address(tok)));
        tok.mint(address(curve), 1e9 ether); curve.seed();
        pons.register(address(tok), address(curve), address(0), 4.2 ether, 200, 200);
        tank = FuelTank(payable(tanks.createTank(address(tok))));
        vm.deal(address(tank), 0.3 ether);
        tok.mint(alice, 300 ether); tok.mint(bob, 100 ether);
    }
    function test_markDead_requiresAgeAndNoProgress() public {
        vm.expectRevert(Graveyard.Alive.selector); grave.markDead(address(tok));
        vm.warp(block.timestamp + 7 days);
        grave.markDead(address(tok));
        assertTrue(grave.isDead(address(tok)));
        (, uint256 pot,,) = grave.graves(address(tok)); assertEq(pot, 0.3 ether);
        assertEq(tank.available(), 0);
    }
    function test_markDead_refusedWithProgress() public {
        vm.deal(bob, 1 ether); vm.prank(bob); curve.buy{value: 0.1 ether}(0.1 ether, 0, bob); // 0.097 > 1% of 4.2
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(Graveyard.Alive.selector); grave.markDead(address(tok));
    }
    function test_deadTokens_cannotBeBoosted() public {
        vm.warp(block.timestamp + 7 days); grave.markDead(address(tok));
        vm.deal(alice, 1 ether); vm.prank(alice); vm.expectRevert(Booster.Dead.selector);
        booster.open{value: 0.01 ether}(address(tok), 0.01 ether, 2, 0);
    }
    function test_burnAndClaim_proRata() public {
        vm.warp(block.timestamp + 7 days); grave.markDead(address(tok));
        vm.startPrank(alice); tok.approve(address(grave), 300 ether); grave.burn(address(tok), 300 ether); vm.stopPrank();
        vm.startPrank(bob); tok.approve(address(grave), 100 ether); grave.burn(address(tok), 100 ether); vm.stopPrank();
        assertEq(tok.balanceOf(address(0xdead)), 400 ether);
        vm.prank(alice); vm.expectRevert(Graveyard.WindowOpen.selector); grave.claim(address(tok));
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice); grave.claim(address(tok)); vm.prank(bob); grave.claim(address(tok));
        assertEq(alice.balance, 0.225 ether); assertEq(bob.balance, 0.075 ether);
        vm.prank(alice); vm.expectRevert(Graveyard.NoTickets.selector); grave.claim(address(tok));
    }
    function test_burn_closedAfterWindow() public {
        vm.warp(block.timestamp + 7 days); grave.markDead(address(tok));
        vm.warp(block.timestamp + 30 days);
        vm.startPrank(alice); tok.approve(address(grave), 1 ether);
        vm.expectRevert(Graveyard.WindowClosed.selector); grave.burn(address(tok), 1 ether); vm.stopPrank();
    }
}
```

**Step 2: Run, expect failure**

Run: `cd contracts && forge test --match-contract GraveyardTest`
Expected: compile error, `Graveyard` missing.

**Step 3: Implement**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPonsCurve} from "./interfaces/IPonsCurve.sol";
import {IPonsFactory} from "./interfaces/IPonsFactory.sol";
import {TankFactory} from "./TankFactory.sol";
import {FuelTank} from "./FuelTank.sol";
import {Booster} from "./Booster.sol";

/// Where dead launches go. Their tanks become a pot; burners of the dead bag split it pro rata.
contract Graveyard is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error Alive(); error AlreadyDead(); error NotDead(); error HasPositions(); error NoTank();
    error WindowOpen(); error WindowClosed(); error NoTickets(); error PushFailed();

    event Died(address indexed token, uint256 pot, bool graduated);
    event Burned(address indexed token, address indexed burner, uint256 amount);
    event Claimed(address indexed token, address indexed burner, uint256 amount);
    event PotToppedUp(address indexed token, uint256 added);

    struct Grave { uint40 diedAt; uint256 pot; uint256 tickets; address quote; }
    uint256 public constant BURN_WINDOW = 30 days;
    uint256 public constant CURVE_AGE = 7 days;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    TankFactory public immutable tanks; IPonsFactory public immutable pons; Booster public immutable booster;
    mapping(address => Grave) public graves;
    mapping(address => mapping(address => uint256)) public ticketsOf;

    constructor(TankFactory tanks_, IPonsFactory pons_, Booster booster_) { tanks = tanks_; pons = pons_; booster = booster_; }
    receive() external payable {}

    function isDead(address token) public view returns (bool) { return graves[token].diedAt != 0; }

    /// Permissionless. Anyone may bury a token that meets the rule.
    function markDead(address token) external nonReentrant {
        if (isDead(token)) revert AlreadyDead();
        address tankAddr = tanks.tankOf(token); if (tankAddr == address(0)) revert NoTank();
        if (booster.openInterest(token) != 0) revert HasPositions();
        IPonsFactory.LaunchedToken memory L = pons.getLaunchedToken(token);
        IPonsCurve c = IPonsCurve(L.curve);
        bool grad = c.graduated();
        if (!grad) {
            FuelTank tank = FuelTank(payable(tankAddr));
            if (block.timestamp < tank.createdAt() + CURVE_AGE) revert Alive();
            if (c.realQuoteReserve() * 100 >= L.graduationThreshold) revert Alive();
        } else {
            if (booster.quoteDepth(token) * 20 >= L.graduationThreshold) revert Alive();
        }
        uint256 pot = FuelTank(payable(tankAddr)).drain();
        graves[token] = Grave(uint40(block.timestamp), pot, 0, L.pairToken);
        uint256 held = IERC20(token).balanceOf(address(this));
        if (held > 0) IERC20(token).safeTransfer(DEAD, held);      // meme-side fuel of a dead token is worthless
        emit Died(token, pot, grad);
    }
    /// Fees that arrive after death still belong to the burners while the window is open.
    function topUp(address token) external nonReentrant {
        Grave storage g = graves[token]; if (g.diedAt == 0) revert NotDead();
        if (block.timestamp >= g.diedAt + BURN_WINDOW) revert WindowClosed();
        FuelTank tank = FuelTank(payable(tanks.tankOf(token)));
        tank.refuel(); uint256 added = tank.drain();
        g.pot += added; emit PotToppedUp(token, added);
    }
    function burn(address token, uint256 amount) external nonReentrant {
        Grave storage g = graves[token]; if (g.diedAt == 0) revert NotDead();
        if (block.timestamp >= g.diedAt + BURN_WINDOW) revert WindowClosed();
        IERC20(token).safeTransferFrom(msg.sender, DEAD, amount);
        ticketsOf[token][msg.sender] += amount; g.tickets += amount;
        emit Burned(token, msg.sender, amount);
    }
    function claim(address token) external nonReentrant {
        Grave storage g = graves[token]; if (g.diedAt == 0) revert NotDead();
        if (block.timestamp < g.diedAt + BURN_WINDOW) revert WindowOpen();
        uint256 t = ticketsOf[token][msg.sender]; if (t == 0) revert NoTickets();
        ticketsOf[token][msg.sender] = 0;
        uint256 share = g.pot * t / g.tickets;
        if (g.quote == address(0)) { (bool ok,) = msg.sender.call{value: share}(""); if (!ok) revert PushFailed(); }
        else IERC20(g.quote).safeTransfer(msg.sender, share);
        emit Claimed(token, msg.sender, share);
    }
}
```

**Step 4: Run**

Run: `cd contracts && forge test -vv`
Expected: all unit tests pass, including `5 passed` for `GraveyardTest`.

**Step 5: Commit**

```bash
git add contracts && git commit -m "feat: Graveyard with on-chain death rules and pro-rata burn payout"
```

---

### Task 12: Deploy script and addresses file

**Files:**
- Create: `contracts/script/Deploy.s.sol`, `deployments/robinhood.json` (written by hand from the broadcast output)

**Step 1: Script**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Script.sol";
import {TankFactory} from "../src/TankFactory.sol";
import {Booster} from "../src/Booster.sol";
import {Graveyard} from "../src/Graveyard.sol";
import {IPonsFactory} from "../src/interfaces/IPonsFactory.sol";
import {IFeeEscrow} from "../src/interfaces/IFeeEscrow.sol";
import {IPoolManager} from "../src/interfaces/IPoolManager.sol";
import {IStateView} from "../src/interfaces/IStateView.sol";

contract Deploy is Script {
    function run() external {
        address PONS = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e; address ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
        address HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044; address PM = 0x8366a39cc670b4001a1121b8f6a443a643e40951;
        address SV = 0xf3334192d15450cdd385c8b70e03f9a6bd9e673b;
        vm.startBroadcast();
        TankFactory tanks = new TankFactory(IPonsFactory(PONS), IFeeEscrow(ESCROW));
        Booster booster = new Booster(tanks, IPonsFactory(PONS), IPoolManager(PM), IStateView(SV), HOOK,
            Booster.Params(500, 1000, 10, 50, 2000, 5000, 2, 5, 12));
        Graveyard grave = new Graveyard(tanks, IPonsFactory(PONS), booster);
        tanks.wire(address(booster), address(grave)); booster.wire(address(grave));
        vm.stopBroadcast();
        console.log("TankFactory", address(tanks)); console.log("Booster", address(booster)); console.log("Graveyard", address(grave));
    }
}
```

**Step 2: Dry run against the fork**

Run: `cd contracts && forge script script/Deploy.s.sol --rpc-url $ROBINHOOD_RPC`
Expected: simulation succeeds and prints three addresses.

**Step 3: Real deploy (Dani runs this; needs a funded key)**

```bash
cd contracts && forge script script/Deploy.s.sol --rpc-url $ROBINHOOD_RPC --broadcast --interactive
```
Then write the three addresses into `deployments/robinhood.json` as `{"chainId":4663,"tankFactory":"0x…","booster":"0x…","graveyard":"0x…"}` and verify on Blockscout (`https://robinhoodchain.blockscout.com`) with `forge verify-contract … --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api`.

**Step 4: Commit**

```bash
git add contracts/script deployments && git commit -m "feat: deploy script and Robinhood Chain addresses"
```

---

## Phase 2 — Client

The client is vanilla ES modules with three.js from an importmap, served by a tiny Node file server that also proxies `/rpc` (the browser cannot always reach the chain RPC directly, and the proxy is where request pacing lives). No build step, no framework, one global `B` namespace like the old `TW` one.

### Task 13: Client scaffold and RPC proxy

**Files:**
- Create: `index.html`, `css/ui.css`, `server.js`, `js/core.js`

**Step 1: `server.js`**

```js
// Static files + a paced /rpc proxy to Robinhood Chain (public RPC 429s on bursts).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RPC = process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const ROOT = path.resolve('.'); const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };
let queue = Promise.resolve(); const GAP_MS = 60;   // ~16 req/s, under the public limit
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      queue = queue.then(async () => {
        for (let i = 0; i < 4; i++) {
          const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
          if (r.status !== 429) { res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(await r.text()); }
          await new Promise(s => setTimeout(s, 300 * (i + 1)));
        }
        res.writeHead(429); res.end('{"error":{"code":429,"message":"rate limited"}}');
      }).then(() => new Promise(s => setTimeout(s, GAP_MS)));
    }); return;
  }
  const p = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(process.env.PORT || 8080, () => console.log('boosters on http://localhost:' + (process.env.PORT || 8080)));
```

**Step 2: `index.html`**

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Boosters</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="css/ui.css">
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.168.0/examples/jsm/"}}</script>
</head><body>
<canvas id="scene"></canvas>
<div id="hud">
  <div id="status">connecting…</div>
  <div id="panel" hidden>
    <div class="row"><span id="p-sym">—</span><span id="p-alt">—</span></div>
    <div class="row"><label>tank</label><div class="gauge"><div id="p-tank"></div></div><span id="p-tank-txt">—</span></div>
    <div class="row"><label>thrust</label><input id="p-lev" type="range" min="2" max="5" step="1" value="2"><span id="p-lev-txt">2×</span></div>
    <div class="row"><label>margin</label><input id="p-margin" type="text" value="0.01"><span id="p-quote">ETH</span></div>
    <div class="row small" id="p-preview">—</div>
    <div class="row"><button id="p-open">ignite</button><button id="p-connect">connect</button></div>
    <div id="p-positions"></div>
  </div>
  <div id="toast"></div>
</div>
<script type="module" src="js/main.js"></script>
</body></html>
```

**Step 3: `css/ui.css`** — dark, monospace HUD; keep copy short (see memory: short HUD copy, no addresses).

```css
html,body{margin:0;height:100%;background:#05060a;color:#dfe6f2;font:13px/1.4 ui-monospace,Menlo,monospace;overflow:hidden}
#scene{position:fixed;inset:0;display:block}
#hud{position:fixed;inset:0;pointer-events:none}
#status{position:absolute;top:10px;left:12px;opacity:.7}
#panel{position:absolute;right:12px;top:12px;width:280px;padding:12px;background:#0b0e16cc;border:1px solid #232a3a;border-radius:8px;pointer-events:auto;backdrop-filter:blur(6px)}
.row{display:flex;align-items:center;gap:8px;margin:6px 0}.row label{width:52px;opacity:.6}.row.small{opacity:.7;font-size:12px}
.gauge{flex:1;height:8px;background:#141a28;border-radius:4px;overflow:hidden}.gauge>div{height:100%;width:0;background:linear-gradient(90deg,#ff9d2e,#ffe27a);transition:width .4s}
input[type=range]{flex:1}input[type=text]{width:80px;background:#0f1420;border:1px solid #2a3348;color:inherit;padding:3px 6px;border-radius:4px}
button{background:#1b2338;border:1px solid #33405e;color:#fff;padding:5px 10px;border-radius:5px;cursor:pointer}button:hover{background:#26304a}
#toast{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);padding:6px 12px;background:#141a28;border-radius:6px;opacity:0;transition:opacity .3s}
#toast.show{opacity:1}
```

**Step 4: `js/core.js`** — the shared namespace, tiny store, toasts (throttled), formatting.

```js
export const B = { listeners: {}, on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }, emit(ev, a) { (this.listeners[ev] || []).forEach(f => { try { f(a); } catch (e) { console.error(e); } }); } };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
let lastToast = 0;
export function toast(msg) { const now = Date.now(); if (now - lastToast < 1500) return; lastToast = now; const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2400); }
export const fmt = {
  qty(v, sym) { if (!isFinite(v)) return '—'; const s = v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v >= 0.001 ? v.toFixed(4) : v.toExponential(2); return s + (sym ? ' ' + sym : ''); },
  pct(f) { return (f * 100).toFixed(Math.abs(f) < 0.01 ? 2 : 1) + '%'; },
  toWei(s, dec = 18) { const [a, b = ''] = String(s).trim().split('.'); return BigInt(a || '0') * 10n ** BigInt(dec) + BigInt((b + '0'.repeat(dec)).slice(0, dec) || '0'); },
  fromWei(v, dec = 18) { return Number(v) / 10 ** dec; }
};
```

**Step 5: Smoke test**

Create a placeholder `js/main.js` containing `import { B } from './core.js'; document.getElementById('status').textContent = 'boosters';` then run `node server.js` and open http://localhost:8080. Expected: black page, "boosters" top-left, no console errors. Then:

```bash
curl -s -X POST localhost:8080/rpc -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```
Expected: `{"jsonrpc":"2.0","id":1,"result":"0x1237"}`.

**Step 6: Commit**

```bash
git add index.html css server.js js && git commit -m "feat: client scaffold with paced RPC proxy"
```

---

### Task 14: Chain access layer

**Files:**
- Create: `js/chain.js`

Raw JSON-RPC and ABI helpers, lifted from the previous project's `js/pons.js` (see `git show c36c0de:js/pons.js`), extended with batching. Complete file:

```js
// Raw JSON-RPC + minimal ABI. No wallet or ABI library, on purpose.
export const CHAIN_ID = 4663, CHAIN_HEX = '0x1237';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
let rpcId = 1;
export async function rpc(method, params = []) {
  const r = await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result;
}
export const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
export const words = hex => { const h = (hex || '0x').slice(2); const o = []; for (let i = 0; i + 64 <= h.length; i += 64) o.push(BigInt('0x' + h.slice(i, i + 64))); return o; };
export const word = v => BigInt.asUintN(256, BigInt(v)).toString(16).padStart(64, '0');
export const addrWord = a => a.toLowerCase().replace('0x', '').padStart(64, '0');
export const wAddr = w => '0x' + w.toString(16).padStart(40, '0');
export const enc = (sel, ...ws) => sel + ws.join('');
export const callU = async (to, data) => { const w = words(await call(to, data)); return w.length ? w[0] : 0n; };
export const decodeString = hex => { try { const h = hex.slice(2); const off = Number(BigInt('0x' + h.slice(0, 64))) * 2; const len = Number(BigInt('0x' + h.slice(off, off + 64))) * 2; return new TextDecoder().decode(Uint8Array.from(h.slice(off + 64, off + 64 + len).match(/../g).map(x => parseInt(x, 16)))); } catch { return ''; } };
export const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');

// selectors (cast sig) and topics (cast keccak)
export const SEL = {
  // erc20
  balanceOf: '0x70a08231', totalSupply: '0x18160ddd', symbol: '0x95d89b41', decimals: '0x313ce567', allowance: '0xdd62ed3e', approve: '0x095ea7b3',
  // pons curve
  getReserves: '0x0902f1ac', sellableTokens: '0x808bcddc', feeBps: '0x24a9d853', creatorTaxBps: '0xc1bb8901', currentSnipeTaxBps: '0xd7e1ef39',
  graduationThreshold: '0x8b0bc501', realQuoteReserve: '0x4f1f58fd', readyToGraduate: '0xc68360a5', graduated: '0xe7c2b772',
  // pons factory
  getLaunchedToken: '0x3cf28b5a', getLaunchFeePolicy: '0x470ef5fc', pairTokenEconomics: '0x31082134',
  // v4 StateView
  getSlot0: '0xc815641c', getLiquidity: '0xfa6793d5',
  // chainlink
  latestRoundData: '0xfeaf968c',
  // ours (fill after Task 15 computes them)
  tankOf: '', predictTank: '', createTank: '', available: '', lent: '', feesEarned: '', refuel: '',
  open: '', close: '', liquidate: '', positions: '', realizable: '', health: '', maxNotional: '', maxLeverage: '', quoteDepth: '', venueOf: '', nextId: '',
  isDead: '', graves: '', burn: '', claim: '', markDead: ''
};
export const TOPIC = {
  TokenLaunched: '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607',
  CurveBuy: '0xec36bf57' /* full hash: fill from cast keccak */, CurveSell: '0x8113d738',
  Swap: '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f'
};
export const ADDR = {
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', escrow: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',
  hook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044', stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  chainlink: { ETH: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9', NVDA: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15', AAPL: '0x6B22A786bAa607d76728168703a39Ea9C99f2cD0', GOOGL: '0xF6f373a037c30F0e5010d854385cA89185AE638b', SPY: '0x319724394D3A0e3669269846abE664Cd621f9f6A', QQQ: '0x80901d846d5D7B030F26B480776EE3b29374C2ae', GME: '0x27C71df6A64fB476468EdF256CF72c038baB5B67' }
};
```

Fill the empty `SEL` entries with `cast sig` for each of our functions once Booster/TankFactory/Graveyard signatures are final, e.g. `cast sig 'open(address,uint256,uint8,uint256)'`. Fill `TOPIC.CurveBuy/CurveSell` with the full 32-byte hashes from `cast keccak 'CurveBuy(address,address,uint256,uint256,uint256,uint256)'`. `getSlot0`/`getLiquidity` selectors: confirm with `cast sig 'getSlot0(bytes32)'` and `cast sig 'getLiquidity(bytes32)'` and correct if they differ from the values above.

**Verify:** in the browser console after Task 15 wires it: `await B.chain.callU(B.chain.ADDR.chainlink.ETH, B.chain.SEL.latestRoundData)` returns a BigInt round id. Commit:

```bash
git add js/chain.js && git commit -m "feat: raw RPC and ABI helpers with verified selectors"
```

---

### Task 15: Data model — launches, curves, tanks, positions, horizon

**Files:**
- Create: `js/pons.js`, `js/boosters.js`

`js/pons.js` exposes `B.pons` with: `recent(n)` (TokenLaunched logs scanned in ≤ 5,000-block windows, then filtered to "interesting": `realQuoteReserve ≥ 5%` of threshold, or a tank exists), `watch(token)` (6 s poll of the curve or StateView, computes `price` in quote units, `progress`, `venue`, `depth`), a per-pair-token cache of `symbol`, `decimals`, `phantom`, `threshold`, and `horizon(pairSymbol)` reading Chainlink `latestRoundData` (returns `{usd, updatedAt, stale}` with `stale = now − updatedAt > 3600`).

`js/boosters.js` exposes `B.boosters` with reads (`tankOf`, `available`, `maxNotional`, `maxLeverage`, `positions(id)`, `health`, `realizable`, `isDead`) and writes via the injected wallet (`connect`, `open`, `close`, `liquidate`, `burn`, `claim`, `createTank`, `refuel`), plus event polling for `Opened`/`Closed`/`Liquidated`/`Died` on our contracts (topics from `cast keccak` of the event signatures in Booster/Graveyard). Reuse the `connect`/`sendTx`/`ensureAllowance` bodies from `git show c36c0de:js/pons.js` verbatim (they already switch/add Robinhood Chain in the wallet).

Price of a token in quote units: curve → `quoteReserve / tokenReserve` (both scaled by their decimals); pool → `(sqrtPriceX96 / 2^96)^2` oriented so the result is quote per token (invert when quote is currency1).

**Test (manual, browser console):**
```js
const r = await B.pons.recent(20); console.table(r.map(x => ({ sym: x.symbol, quote: x.pair.symbol, progress: x.progress.toFixed(3), venue: x.venue })));
await B.pons.horizon('NVDA')   // → { usd: 218.34, updatedAt: …, stale: true/false }
```
Expected: a table with mixed ETH/NVDA/USDG quotes and a horizon object. Commit:

```bash
git add js/pons.js js/boosters.js && git commit -m "feat: chain data model for launches, tanks, positions and horizon"
```

---

### Task 16: Scene — rockets, horizon, planets, graveyard

**Files:**
- Create: `js/scene.js`, `js/main.js` (replace placeholder)

Three.js scene, one file, no assets: rockets are procedural (cone + cylinder + fins), planets are spheres with an emissive ring, the graveyard is a dark plane at the bottom with instanced debris. Layout:

- **Altitude** `y = log10(price / priceAtLaunch)` scaled to 12 units per decade, clamped to [−3, 3] decades. `priceAtLaunch = phantom / supply` from `pairTokenEconomics`, so rockets start on the horizon and climb as the curve fills.
- **Horizon** is a wide translucent plane at `y = 0` labelled with the quote symbol and its USD from Chainlink; it turns grey when `stale`.
- **X placement** by launch order (newest at the right), **Z** by quote asset lane (ETH lane, NVDA lane, …) so a viewer can read "these are the NVDA rockets".
- **Fuel** as a bar on the rocket body: `available / (threshold)` filled; a second, dimmer segment shows the depth-capped lendable portion (`maxNotional − margin`).
- **Thruster** flame length ∝ chosen leverage when the rocket is selected.
- **Planets** for `venue === 'pool'`: radius from `depth / threshold` (clamped), orbit speed from 24 h swap count, positioned on a ring above the launch zone.
- **Explosion**: on `Liquidated`, spawn 200 debris particles at the rocket, fall to the graveyard plane, fade.
- **Graveyard**: dead tokens as wreckage; clicking one opens burn/claim.

`js/main.js` wires it: `B.pons.recent(40)` → `scene.addRocket(...)`, poll updates → `scene.update(token, state)`, HUD panel bindings (thruster slider → `B.boosters.maxLeverage` gating, margin input → preview using the same `PonsMath` formulas in JS: `quoteBuy`, then `quoteSell` of the result for the realizable mark, liquidation altitude solved by bisection on the constant-product sell formula), and toasts for tx state (short copy, throttled).

Use the `3dviz-pro-max` skill when implementing this task for the scene composition and camera work.

**Test (manual):** open the page; expect rockets on lanes, one horizon per lane, at least one planet (graduated pool) and the selected rocket showing a preview line like `2× · mark −3.1% · boom at −41%`.

Commit:
```bash
git add js/scene.js js/main.js && git commit -m "feat: rockets, horizon, planets and graveyard scene"
```

---

### Task 17: README

**Files:**
- Create: `README.md`

Cover: what Boosters is in one paragraph; the numbers from the design doc §2; how the tank is fed (`transferCreatorFeeRecipient` to `predictTank(token)`); the depth cap; running the contracts tests (`forge test`, fork test with `ROBINHOOD_RPC`); running the client (`node server.js`); the risk paragraph (physical leverage on thin curves, own impact, fee compounding, US-person restriction on Stock Tokens); addresses from `deployments/robinhood.json`.

Commit: `git add README.md && git commit -m "docs: README"`.

---

## Verification checklist before calling Phase 1 done

- `cd contracts && forge test` → all unit suites green with no network.
- `forge test --match-contract PoolVenueFork --fork-url $ROBINHOOD_RPC` → green.
- `forge script script/Deploy.s.sol --rpc-url $ROBINHOOD_RPC` simulates.
- Every `SEL`/`TOPIC` in `js/chain.js` was produced by `cast sig` / `cast keccak`, not typed from memory.
- Re-read design doc §3 caveats and tick each: realizable mark (Task 6/7), graduation boundary (Task 9), fee compounding shown in the preview (Task 16), snipe reachable only via creator share (no code needed), creator must point fees at the tank (README), escrow per-asset balances (Task 5 `refuel`), Chainlink stale handling (Task 15/16), RPC pacing (Task 13).
