import chai, {expect} from 'chai'
import {Contract} from 'ethers'
import {BigNumber} from 'ethers/utils'
import {AddressZero} from 'ethers/constants'
import {createFixtureLoader, MockProvider, solidity} from 'ethereum-waffle'
import {expandTo18Decimals, expandTo6Decimals, sleep} from './shared/utilities'
import {getAmountOut, getPair, HotPotFixture, mintAndDepositHotPotFund} from './shared/fixtures'


chai.use(require('chai-shallow-deep-equal'));
chai.use(solidity);

const INIT_DEPOSIT_AMOUNT_18 = expandTo18Decimals(1e3);
const INIT_DEPOSIT_AMOUNT_6 = expandTo6Decimals(1e3);
const INIT_HARVEST_AMOUNT_18 = expandTo18Decimals(25);
const INIT_HARVEST_AMOUNT_6 = expandTo6Decimals(25);

describe('HotPotController', () => {
    //获取provider环境
    const provider = new MockProvider({
        hardfork: 'istanbul',
        mnemonic: 'hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot',
        gasLimit: 9999999
    });
    const [manager, depositor, trader, other] = provider.getWallets();
    const governance = manager;
    const loadFixture = createFixtureLoader(provider, [manager]);

    let fixture: HotPotFixture;
    let controller: Contract;
    let hotPotFund: Contract;
    let investToken: Contract;
    let tokenHotPot: Contract;
    let pool1: Contract;
    let pool2: Contract;
    let INIT_DEPOSIT_AMOUNT: BigNumber;
    let INIT_HARVEST_AMOUNT: BigNumber;
    let mintPair: Contract;

    before(async () => {
        fixture = await loadFixture(HotPotFixture);
        controller = fixture.hotPotController;
        tokenHotPot = fixture.tokenHotPot;

        const TOKEN_TYPE = "DAI";//case ETH/DAI/USDT/USDC
        hotPotFund = (<any>fixture)["hotPotFund" + TOKEN_TYPE];
        investToken = (<any>fixture)["token" + TOKEN_TYPE];

        let pools = [fixture.tokenDAI, fixture.tokenUSDC, fixture.tokenUSDT, fixture.tokenWETH];
        const index = pools.findIndex(value => value.address == investToken.address);
        pools.splice(index, 1);
        pool1 = pools[0];
        pool2 = pools[1];
        mintPair = await getPair(fixture.factory, fixture.tokenETH.address,
            investToken.address != fixture.tokenETH.address ? investToken.address : fixture.tokenDAI.address);

        INIT_DEPOSIT_AMOUNT = await investToken.decimals() == 18 ? INIT_DEPOSIT_AMOUNT_18 : INIT_DEPOSIT_AMOUNT_6;
        INIT_HARVEST_AMOUNT = await investToken.decimals() == 18 ? INIT_HARVEST_AMOUNT_18 : INIT_HARVEST_AMOUNT_6;

        await mintAndDepositHotPotFund(hotPotFund, investToken, depositor, INIT_DEPOSIT_AMOUNT);
    });

    beforeEach(async () => {
        Object.keys(fixture).forEach(key => {
            (fixture as any)[key].connect(manager);
        });
    });

    it('hotpot, manager, governance', async () => {
        await expect(await controller.hotpot()).to.eq(tokenHotPot.address);
        await expect(await controller.manager()).to.eq(manager.address);
        await expect(await controller.governance()).to.eq(governance.address);
    });

    function harvest(builder: () => any) {
        return async () => {
            const {amountIn} = await builder();
            const {amountOut, pair} = await getAmountOut(fixture.factory, fixture.router,
                investToken.address, tokenHotPot.address, amountIn);

            //transfer token to hotPotController for testing harvest
            await expect(investToken.transfer(controller.address, amountIn))
                .to.not.be.reverted;
            //token balance of controller = amountIn
            await expect(await investToken.balanceOf(controller.address))
                .to.eq(amountIn);

            //error pair
            await expect(controller.harvest(tokenHotPot.address, amountIn))
                .to.be.revertedWith("Pair not exist.");

            //amountIn = 0
            await expect(controller.harvest(investToken.address, 0))
                .to.be.reverted;

            //amountIn = daiAmountIn
            await expect(controller.harvest(investToken.address, amountIn))
                //uniswap
                .to.emit(tokenHotPot, "Transfer")
                .withArgs(pair.address, controller.address, amountOut)
                //burn
                .to.emit(tokenHotPot, "Transfer")
                .withArgs(controller.address, AddressZero, amountOut);
        }
    }

    it("harvest", harvest(() => {
        return {
            amountIn: INIT_HARVEST_AMOUNT
        }
    }));


    function addPool(builder: () => any) {
        return async () => {
            const {pool1, pool2} = await builder();

            //Non-Manager operation
            await expect(controller.connect(depositor).addPool(hotPotFund.address, pool1.address, 100))
                .to.be.revertedWith("Only called by Manager.");

            //init proportion pool1=100
            await expect(controller.addPool(hotPotFund.address, pool1.address, 100))
                .to.not.be.reverted;

            //proportion pool1=50、poo2=50
            await expect(controller.addPool(hotPotFund.address, pool2.address, 50))
                .to.not.be.reverted;
        }
    }

    it('addPool', addPool(async () => {
        return {pool1, pool2};
    }));

    function setSwapPath(builder: () => any) {
        return async () => {
            if (investToken.address == fixture.tokenWETH.address) return;

            const {tokenIn, tokenOut, path} = await builder();
            //Non-Manager operation
            await expect(controller.connect(depositor).setSwapPath(hotPotFund.address, tokenIn.address, tokenOut.address, path))
                .to.be.revertedWith("Only called by Manager.");

            //DAi->USDC = Uniswap(0)
            await expect(controller.connect(manager).setSwapPath(hotPotFund.address, tokenIn.address, tokenOut.address, path))
                .to.not.be.reverted;
        }
    }

    it('setSwapPath: Uniswap', setSwapPath(async () => {
        return {
            tokenIn: investToken,
            tokenOut: pool1,
            path: 0 //Uniswap(0) Curve(1)
        }
    }));

    it('setSwapPath: Curve', setSwapPath(async () => {
        return {
            tokenIn: investToken,
            tokenOut: pool2,
            path: 1 //Uniswap(0) Curve(1)
        }
    }));

    function invest(builder: () => any) {
        return async () => {
            const {amount} = await builder();
            //Non-Manager operation
            await expect(controller.connect(depositor).invest(hotPotFund.address, amount))
                .to.be.revertedWith("Only called by Manager.");

            //invest amount
            await expect(controller.connect(manager).invest(hotPotFund.address, amount))
                .to.not.be.reverted;
        }
    }

    it('invest', invest(async () => {
        const amount = INIT_DEPOSIT_AMOUNT;
        await sleep(1);
        return {amount}
    }));

    function adjustPool(builder: () => any) {
        return async () => {
            const {upIndex, downIndex, proportion} = await builder();
            //Non-Manager operation
            await expect(controller.connect(depositor).adjustPool(hotPotFund.address, upIndex, downIndex, proportion))
                .to.be.revertedWith("Only called by Manager.");

            //USDC up 10 proportion, USDT down 10 proportion
            await expect(controller.adjustPool(hotPotFund.address, upIndex, downIndex, proportion))
                .to.not.be.reverted;
        }
    }

    it('adjustPool', adjustPool(() => {
        return {
            upIndex: 0,
            downIndex: 1,
            proportion: 10
        };
    }));


    function reBalance(builder: () => any) {
        return async () => {
            const {addIndex, removeIndex} = await builder();

            const addTokenAddr = (await hotPotFund.pools(addIndex)).token;
            const removeTokenAddr = (await hotPotFund.pools(removeIndex)).token;

            const fundTokenAddr = hotPotFund.token ? await hotPotFund.token() : fixture.tokenWETH.address;
            // const addPair = await getPair(fixture.factory, fundTokenAddr, addTokenAddr);
            const removePair = await getPair(fixture.factory, fundTokenAddr, removeTokenAddr);

            // const addSumLiquidity = await addPair.balanceOf(hotPotFund.address);
            const removeSumLiquidity = await removePair.balanceOf(hotPotFund.address);
            const removeLiquidity = removeSumLiquidity.div(2);// MINIMUM_LIQUIDITY = 1000

            //Non-Manager operation
            await expect(controller.connect(depositor).reBalance(hotPotFund.address, addIndex, removeIndex, removeLiquidity))
                .to.be.revertedWith("Only called by Manager.");

            //reBalance
            await expect(controller.connect(manager).reBalance(hotPotFund.address, addIndex, removeIndex, removeLiquidity))
                .to.not.be.reverted;
        }
    }

    it('reBalance', reBalance(async () => {
        await sleep(1);
        return {addIndex: 0, removeIndex: 1};
    }));

    it('stakeMintingUNI', async () => {
        //Non-Manager operation
        await expect(controller.connect(depositor).stakeMintingUNI(
            hotPotFund.address, mintPair.address))
            .to.be.revertedWith("Only called by Manager.");

        await expect(controller.connect(manager).stakeMintingUNI(
            hotPotFund.address, mintPair.address))
            .to.not.be.reverted;
    });

    it('stakeMintingUNIAll', async () => {
        //Non-Manager operation
        await expect(controller.connect(depositor).stakeMintingUNIAll(hotPotFund.address))
            .to.be.revertedWith("Only called by Manager.");

        await expect(controller.connect(manager).stakeMintingUNIAll(hotPotFund.address))
            .to.not.be.reverted;
    });

    it('setManager', async () => {
        //Non-Manager operation
        await expect(controller.connect(depositor).setManager(manager.address))
            .to.be.revertedWith("Only called by Manager.");

        await expect(controller.connect(manager).setManager(depositor.address)).to.not.be.reverted;
        await expect(await controller.manager()).to.eq(depositor.address);
        await expect(controller.connect(depositor).setManager(manager.address)).to.not.be.reverted;
        await expect(await controller.manager()).to.eq(manager.address);
    });

    it('setGovernance', async () => {
        //Non-Governance operation
        await expect(controller.connect(depositor).setGovernance(manager.address))
            .to.be.revertedWith("Only called by Governance.");

        await expect(controller.connect(governance).setGovernance(depositor.address)).to.not.be.reverted;
        await expect(await controller.governance()).to.eq(depositor.address);
        await expect(controller.connect(depositor).setGovernance(governance.address)).to.not.be.reverted;
        await expect(await controller.governance()).to.eq(governance.address);
    });

    it('setMintingUNIPool', async () => {
        const mintPair = (await getPair(fixture.factory, fixture.tokenETH.address, fixture.tokenDAI.address));
        //Non-Governance operation
        await expect(controller.connect(depositor).setMintingUNIPool(
            hotPotFund.address, mintPair.address, fixture.uniStakingRewardsDAI.address))
            .to.be.revertedWith("Only called by Governance.");

        await expect(controller.connect(governance).setMintingUNIPool(
            hotPotFund.address, mintPair.address, fixture.uniStakingRewardsDAI.address))
            .to.not.be.reverted;
    });

    it('setTrustedToken', async () => {
        //Non-Governance operation
        await expect(controller.connect(depositor).setGovernance(manager.address))
            .to.be.revertedWith("Only called by Governance.");

        await expect(controller.connect(governance).setTrustedToken(fixture.tokenDAI.address, false))
            .to.emit(controller, "ChangeTrustedToken")
            .withArgs(fixture.tokenDAI.address, false);
        await expect(await controller.trustedToken(fixture.tokenDAI.address)).to.eq(false);

        await expect(controller.connect(governance).setTrustedToken(fixture.tokenDAI.address, true))
            .to.emit(controller, "ChangeTrustedToken")
            .withArgs(fixture.tokenDAI.address, true);
        await expect(await controller.trustedToken(fixture.tokenDAI.address)).to.eq(true);
    });
});
