import chai, {expect} from 'chai'
import {Contract} from 'ethers'
import {BigNumber, bigNumberify, formatUnits} from 'ethers/utils'
import {AddressZero, MaxUint256} from 'ethers/constants'
import {createFixtureLoader, MockProvider, solidity} from 'ethereum-waffle'

import {expandTo18Decimals, expandTo6Decimals, printGasLimit, sleep} from './shared/utilities'

import {getPair, HotPotFixture, INIT_STAKE_REWARDS_AMOUNT, printPairsStatus, readStatus} from './shared/fixtures'

chai.use(require('chai-shallow-deep-equal'));
chai.use(solidity);

const initDepositAmount = 10000;
const INIT_DEPOSIT_AMOUNT_18 = expandTo18Decimals(initDepositAmount);
const INIT_DEPOSIT_AMOUNT_6 = expandTo6Decimals(initDepositAmount);
const FEE = 20;
const DIVISOR = 100;


describe('HotPotFund', () => {
    const provider = new MockProvider({
        hardfork: 'istanbul',
        mnemonic: 'hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot',
        gasLimit: 9999999,
    });

    const [manager, depositor, trader, other, others] = provider.getWallets();
    const governance = manager;
    const loadFixture = createFixtureLoader(provider, [manager]);
    let TOKEN_TYPE: string;
    let fixture: HotPotFixture;
    let controller: Contract;
    let tokenHotPot: Contract;
    let tokens: Array<Contract>;

    let hotPotFund: Contract;
    let investToken: Contract;

    let INIT_DEPOSIT_AMOUNT: BigNumber;
    const INIT_PROPORTIONS = [25, 25, 50];

    let expectedDepositAmount = bigNumberify(0);
    let expectedWithdrawAmount = bigNumberify(0);
    let expectedShareAmount = bigNumberify(0);

    before(async () => {
        TOKEN_TYPE = "DAI"; //DAI/USDC/USDT/ETH
        fixture = await loadFixture(HotPotFixture);
        controller = fixture.hotPotController;
        tokenHotPot = fixture.tokenHotPot;

        hotPotFund = (<any>fixture)["hotPotFund" + TOKEN_TYPE];
        investToken = (<any>fixture)["token" + TOKEN_TYPE];

        tokens = [fixture.tokenDAI, fixture.tokenUSDC, fixture.tokenUSDT, fixture.tokenWETH, fixture.tokenHotPot];
        const index = tokens.findIndex(value => value.address == investToken.address);
        tokens.splice(index, 1);

        INIT_DEPOSIT_AMOUNT = await investToken.decimals() == 18 ? INIT_DEPOSIT_AMOUNT_18 : INIT_DEPOSIT_AMOUNT_6;

        if (investToken.address != fixture.tokenWETH.address) {
            await investToken._mint_for_testing(depositor.address, INIT_DEPOSIT_AMOUNT);
            await investToken._mint_for_testing(trader.address, INIT_DEPOSIT_AMOUNT);
        }

        //UNI DAI-ETH mining
        await fixture.tokenUNI.transfer(fixture.uniStakingRewardsDAI.address, INIT_STAKE_REWARDS_AMOUNT);
        await fixture.uniStakingRewardsDAI.notifyRewardAmount(INIT_STAKE_REWARDS_AMOUNT);
        //UNI USDC-ETH mining
        await fixture.tokenUNI.transfer(fixture.uniStakingRewardsUSDC.address, INIT_STAKE_REWARDS_AMOUNT);
        await fixture.uniStakingRewardsUSDC.notifyRewardAmount(INIT_STAKE_REWARDS_AMOUNT);
        //UNI USDT-ETH mining
        await fixture.tokenUNI.transfer(fixture.uniStakingRewardsUSDT.address, INIT_STAKE_REWARDS_AMOUNT);
        await fixture.uniStakingRewardsUSDT.notifyRewardAmount(INIT_STAKE_REWARDS_AMOUNT);
    });

    beforeEach(async () => {
        Object.keys(fixture).forEach(key => {
            (fixture as any)[key].connect(manager);
        });
    });

    //token, controller, totalInvestment, pairsLength, curve_tokenID, paths
    it('readInitStatus', readStatus(() => {
            const target = hotPotFund;
            const caseData = {
                token: {
                    value: investToken.address
                },
                controller: {
                    value: controller.address
                },
                totalInvestment: {
                    value: 0
                },
                // pairs: {
                //     symbol: "shallowDeepEqual",
                //     args: [0],
                //     value: AddressZero
                // },
                pairsLength: {
                    value: 0
                },
                curve_tokenID: [
                    {
                        args: [fixture.tokenDAI.address],
                        value: 0
                    },
                    {
                        args: [fixture.tokenUSDC.address],
                        value: 1
                    },
                    {
                        args: [fixture.tokenUSDT.address],
                        value: 2
                    },
                ],
                paths: {
                    args: [fixture.tokenDAI.address, fixture.tokenUSDC.address],
                    value: 0
                }
            };
            if (investToken.address == fixture.tokenWETH.address) {
                delete caseData.token;
                delete caseData.curve_tokenID;
                delete caseData.paths;
            }
            return {target, caseData};
        }
    ));

    it('setUNIPool', async () => {
        //Non-Controller operation
        await expect(hotPotFund.setUNIPool(await fixture.factory.getPair(fixture.tokenWETH.address, fixture.tokenDAI.address), fixture.uniStakingRewardsDAI.address))
            .to.be.revertedWith("Only called by Controller.");

        if (investToken.address != fixture.tokenWETH.address) {
            await expect(controller.connect(governance).setUNIPool(hotPotFund.address, await fixture.factory.getPair(fixture.tokenWETH.address, investToken.address), (fixture as any)["uniStakingRewards" + TOKEN_TYPE].address))
                .to.not.be.reverted;
        } else {
            await expect(controller.connect(governance).setUNIPool(hotPotFund.address, await fixture.factory.getPair(fixture.tokenWETH.address, fixture.tokenDAI.address), fixture.uniStakingRewardsDAI.address))
                .to.not.be.reverted;
            await expect(controller.connect(governance).setUNIPool(hotPotFund.address, await fixture.factory.getPair(fixture.tokenWETH.address, fixture.tokenUSDC.address), fixture.uniStakingRewardsUSDC.address))
                .to.not.be.reverted;
            await expect(controller.connect(governance).setUNIPool(hotPotFund.address, await fixture.factory.getPair(fixture.tokenWETH.address, fixture.tokenUSDT.address), fixture.uniStakingRewardsUSDT.address))
                .to.not.be.reverted;
        }
    });

    function addPair(builder: () => any) {
        return async () => {
            const {tokenArr} = await builder();
            //not trusted token
            await expect(controller.addPair(hotPotFund.address, hotPotFund.address))
                .to.be.revertedWith('The token is not trusted.');
            //error pair
            await expect(controller.addPair(hotPotFund.address, investToken.address))
                .to.be.revertedWith('Pair not exist.');

            //Non-Controller operation
            await expect(hotPotFund.addPair(tokenArr[0].address))
                .to.be.revertedWith("Only called by Controller.");

            //token1
            let transaction = await controller.addPair(hotPotFund.address, tokenArr[0].address);
            printGasLimit(transaction, "first-add");
            await expect(Promise.resolve(transaction)).to.not.be.reverted;
            if (tokens.length == 1) return;

            //token2
            transaction = await controller.addPair(hotPotFund.address, tokenArr[1].address);
            printGasLimit(transaction, "second-add");
            await expect(Promise.resolve(transaction)).to.not.be.reverted;
            if (tokens.length == 2) return;

            //token3
            transaction = await controller.addPair(hotPotFund.address, tokenArr[2].address);
            printGasLimit(transaction, "third-add");
            await expect(Promise.resolve(transaction)).to.not.be.reverted;
            if (tokens.length == 3) return;

            await expect(controller.addPair(hotPotFund.address, tokenArr[2].address))
                .to.be.revertedWith('Add pair repeatedly.');

            //pairsLength = 3
            await expect(await hotPotFund.pairsLength()).to.eq(3);
            await expect(await hotPotFund.pairs(0)).to.eq(tokenArr[0].address);
            await expect(await hotPotFund.pairs(1)).to.eq(tokenArr[1].address);
            await expect(await hotPotFund.pairs(2)).to.eq(tokenArr[2].address);
        };
    }

    it('invest: fail before adding pair', async () => {
        await expect(controller.connect(manager).invest(hotPotFund.address, INIT_DEPOSIT_AMOUNT, INIT_PROPORTIONS))
            .to.be.revertedWith("Pairs is empty.");
    });

    it("addPair: init 3 pair", addPair(() => {
        return {
            tokenArr: tokens
        }
    }));


    function deposit(builder: () => any) {
        return async () => {
            const {depositAmount} = await builder();
            await investToken.connect(depositor).approve(hotPotFund.address, MaxUint256);

            const totalSupply = await hotPotFund.totalSupply();
            const totalAssets = await hotPotFund.totalAssets();
            const investmentOf = await hotPotFund.investmentOf(depositor.address);
            const totalInvestment = await hotPotFund.totalInvestment();

            const expectShare = totalAssets.gt(0) ? depositAmount.mul(totalSupply).div(totalAssets) : depositAmount;
            const transaction = investToken.address != fixture.tokenWETH.address
                ? await hotPotFund.connect(depositor).deposit(depositAmount)
                : await hotPotFund.connect(depositor).deposit({value: depositAmount});

            printGasLimit(transaction, "deposit");
            await expect(Promise.resolve(transaction))
                .to.emit(hotPotFund, "Transfer")
                .withArgs(AddressZero, depositor.address, expectShare)
                .to.emit(hotPotFund, 'Deposit')
                .withArgs(depositor.address, depositAmount, expectShare);
            await readStatus(() => {
                return {
                    target: hotPotFund,
                    caseData: {
                        totalSupply: {
                            value: totalSupply.add(expectShare)
                        },
                        totalAssets: {
                            value: totalAssets.add(depositAmount)
                        },
                        investmentOf: {
                            args: [depositor.address],
                            value: investmentOf.add(depositAmount)
                        },
                        totalInvestment: {
                            value: totalInvestment.add(depositAmount)
                        }
                    }
                }
            })();
        }
    }

    it("deposit: half of amount", deposit(async () => {
        const depositAmount = INIT_DEPOSIT_AMOUNT.div(2);
        expectedDepositAmount = expectedDepositAmount.add(depositAmount);
        const sumAssets = await calSumAssets();
        const share = sumAssets.gt(0) ? depositAmount.mul(expectedShareAmount).div(sumAssets) : depositAmount;
        expectedShareAmount = expectedShareAmount.add(share);
        return {depositAmount};
    }));

    it('mineUNIAll: after deposit and before invest', async () => {
        //Non-Controller operation
        await expect(hotPotFund.mineUNIAll())
            .to.be.revertedWith("Only called by Controller.");

        await expect(controller.mineUNIAll(hotPotFund.address))
            .to.not.be.reverted;

        await expect(await hotPotFund.debtOf(depositor.address))
            .to.eq(bigNumberify(0));

        await expect(await hotPotFund.totalDebts())
            .to.eq(bigNumberify(0));
    });

    function invest(builder: () => any) {
        return async () => {
            const {amount} = await builder();
            //Non-Manager operation
            await expect(controller.connect(depositor).invest(hotPotFund.address, amount, INIT_PROPORTIONS))
                .to.be.revertedWith("Only called by Manager.");

            //Not enough balance.
            await expect(controller.connect(manager).invest(hotPotFund.address, MaxUint256, INIT_PROPORTIONS))
                .to.be.revertedWith("Not enough balance.");
            //Index out of range
            await expect(controller.connect(manager).invest(hotPotFund.address, amount, [25, 25, 25, 25]))
                .to.be.revertedWith("Proportions index out of range.");
            // Error proportion
            await expect(controller.connect(manager).invest(hotPotFund.address, amount.div(2), [25, 25, 51]))
                .to.be.revertedWith("Error proportion.");

            //invest amount
            const transaction = await controller.connect(manager).invest(hotPotFund.address, amount, INIT_PROPORTIONS);
            printGasLimit(transaction, "invest");
            await expect(Promise.resolve(transaction)).to.not.be.reverted;
            const remaining = await investToken.balanceOf(hotPotFund.address);
            // console.log(`remaining invest token: ${formatUnits(remaining, 18)}`);
        }
    }

    async function calSumRemoveAmount(shareAmount: BigNumber, isCurve: boolean = false) {
        const totalSupply = await hotPotFund.totalSupply();
        let sumRemoveAmount = (await investToken.balanceOf(hotPotFund.address)).mul(shareAmount).div(totalSupply);
        for (let i = 0; i < tokens.length - 1; i++) {
            let tokenAddr = tokens[i].address;
            const pair = await getPair(fixture.factory, investToken.address, tokenAddr);
            let liquidity = (await pair.balanceOf(hotPotFund.address)).mul(shareAmount).div(totalSupply);
            liquidity = liquidity.add((await balanceOfStaking(pair)).mul(shareAmount).div(totalSupply));
            const totalLP = await pair.totalSupply();
            const {reserve0, reserve1} = await pair.getReserves();
            if (liquidity.eq(0)) continue;
            const amount0 = reserve0.mul(liquidity).div(totalLP);
            const amount1 = reserve1.mul(liquidity).div(totalLP);
            if (await pair.token0() == tokenAddr) {
                sumRemoveAmount = sumRemoveAmount.add(amount1).add(await fixture.router.getAmountOut(amount0, reserve0.sub(amount0), reserve1.sub(amount1)));
            } else {
                sumRemoveAmount = sumRemoveAmount.add(amount0).add(await fixture.router.getAmountOut(amount1, reserve1.sub(amount1), reserve0.sub(amount0)));
            }
        }
        return sumRemoveAmount;
    }

    async function balanceOfStaking(pair: Contract) {
        if (fixture.factory.uniPool[pair.address]) {
            return await fixture.factory.uniPool[pair.address].balanceOf(hotPotFund.address);
        } else {
            return bigNumberify(0);
        }
    }

    async function calSumAssets() {
        let sumAmount = await investToken.balanceOf(hotPotFund.address);
        // console.log(`sumAmount:balance,${sumAmount}`);
        for (let i = 0; i < tokens.length - 1; i++) {
            const tokenAddr = tokens[i].address;
            const pair = await getPair(fixture.factory, investToken.address, tokenAddr);
            let liquidity = (await pair.balanceOf(hotPotFund.address)).add(await balanceOfStaking(pair));
            const totalLP = await pair.totalSupply();
            const {reserve0, reserve1} = await pair.getReserves();
            if (await pair.token0() == tokenAddr) {
                sumAmount = sumAmount.add(reserve1.mul(2).mul(liquidity).div(totalLP));
            } else {
                sumAmount = sumAmount.add(reserve0.mul(2).mul(liquidity).div(totalLP));
            }
            // console.log(`sumAmount:add pair_${i},${sumAmount}`);
        }
        return sumAmount;
    }

    async function calUNIAmount(share: BigNumber, sumShare: BigNumber, totalSupply: BigNumber, timestamp: BigNumber) {
        const uniAmount = await fixture.tokenUNI.balanceOf(hotPotFund.address);
        const totalDebts = await hotPotFund.totalDebts();
        const userDebt = await hotPotFund.debtOf(depositor.address);
        const totalAmount = totalDebts.add(uniAmount).mul(share).div(totalSupply);
        let reward = bigNumberify(0), debt = bigNumberify(0);
        if (totalAmount > 0) {
            debt = userDebt.mul(share).div(sumShare);
            reward = totalAmount.sub(debt);
            if (reward > uniAmount) reward = uniAmount;
        }
        console.log(`reward:${reward}, uniAmount:${uniAmount}, totalDebts:${totalDebts}, userDebt:${userDebt}, totalAmount:${totalAmount}`);

        return {reward, debt, totalDebts: totalDebts.sub(debt), userDebt: userDebt.sub(debt)};
    }

    function withdraw(builder: () => any) {
        return async () => {
            const {shareAmount, isCurve} = await builder();

            //update block.timestamp
            await other.sendTransaction({to: manager.address, value: bigNumberify(1)});
            await sleep(1);

            const totalSupply = await hotPotFund.totalSupply();
            const userSumShare = await hotPotFund.balanceOf(depositor.address);

            const totalInvestment = await hotPotFund.totalInvestment();
            const investmentOf = await hotPotFund.investmentOf(depositor.address);

            // console.log(`UNI Balance：${await fixture.tokenUNI.balanceOf(depositor.address)}`);

            // share<=0
            await expect(hotPotFund.connect(depositor).withdraw(expandTo18Decimals(0)))
                .to.be.revertedWith("Not enough balance.");
            // share>balanceOf
            await expect(hotPotFund.connect(depositor).withdraw(userSumShare.add(1)))
                .to.be.revertedWith("Not enough balance.");
            // shareAmount<=balanceOf
            await expect(shareAmount.lte(userSumShare)).to.be.true;

            let removeInvestment = investmentOf.mul(shareAmount).div(totalSupply);
            let sumRemoveAmount = await calSumRemoveAmount(shareAmount, isCurve);
            let removeToUserAmount = sumRemoveAmount;
            let _fee = bigNumberify(0);

            if (removeToUserAmount.gt(removeInvestment)) {
                _fee = (sumRemoveAmount.sub(removeInvestment)).mul(FEE).div(DIVISOR);
                removeToUserAmount = sumRemoveAmount.sub(_fee);
            } else {
                removeInvestment = sumRemoveAmount;
            }

            // const earned = await fixture.uniStakingRewardsDAI.earned(hotPotFund.address);
            // const totalUNI = await hotPotFund.totalUNIRewards();
            const mySumUNIReward = await hotPotFund.UNIRewardsOf(depositor.address);
            const depositorETHBalance = await depositor.getBalance();
            const transaction = await hotPotFund.connect(depositor).withdraw(shareAmount);
            const gasFee = transaction.gasLimit.mul(transaction.gasPrice);
            const depositorETHBalance2 = await depositor.getBalance();
            // const leaveTotalUNI = await hotPotFund.totalUNIRewards();
            // const myLeaveUNIReward = await hotPotFund.UNIRewardsOf(depositor.address);

            printGasLimit(transaction, "withdraw-" + (_fee.gt(0) ? "have-income" : "no-income"));
            // console.log(`removeToUserAmount:${removeToUserAmount}, fee:${_fee}`);
            // console.log(`UNI Balance：${await fixture.tokenUNI.balanceOf(depositor.address)}`);

            await expect(Promise.resolve(transaction))
                //burn
                .to.emit(hotPotFund, "Transfer")
                .withArgs(depositor.address, AddressZero, shareAmount)
                //emit
                .to.emit(hotPotFund, 'Withdraw')
                .withArgs(depositor.address, removeToUserAmount, shareAmount);

            if (_fee.gt(0)) {
                await expect(Promise.resolve(transaction))
                    //fee
                    .to.emit(investToken, "Transfer")
                    .withArgs(hotPotFund.address, controller.address, _fee);
            }

            if (investToken.address != fixture.tokenWETH.address) {
                await expect(Promise.resolve(transaction))
                    //investToken Transfer
                    .to.emit(investToken, "Transfer")
                    .withArgs(hotPotFund.address, depositor.address, removeToUserAmount);
            } else {
                await expect(Promise.resolve(transaction))
                    //investToken Transfer
                    .to.emit(investToken, "Withdrawal")
                    .withArgs(hotPotFund.address, removeToUserAmount);
                // console.log(`gasFee:${gasFee}, depositorETHBalance:${depositorETHBalance}, depositorETHBalance2: ${depositorETHBalance2}`);
                await expect(depositorETHBalance2).be.gte(depositorETHBalance.add(removeToUserAmount).sub(gasFee));
            }

            const reward = mySumUNIReward.mul(shareAmount).div(userSumShare);
            // console.log(`earned:${earned}, totalUNI: ${totalUNI}, leaveTotalUNI:${leaveTotalUNI}, mySumUNIReward:${mySumUNIReward}, myLeaveUNIReward:${myLeaveUNIReward}, getReward:${reward}`);
            if (reward.gt(0)) {
                await expect(Promise.resolve(transaction))
                    // UNI Transfer
                    .to.emit(fixture.tokenUNI, "Transfer")
                    .withArgs(hotPotFund.address, depositor.address, reward);
            }

            //totalSupply
            await expect(await hotPotFund.totalSupply()).to.eq(totalSupply.sub(shareAmount));
            //totalAssets
            await expect(await hotPotFund.totalAssets()).to.eq(await calSumAssets());
            //investmentOf
            await expect(await hotPotFund.investmentOf(depositor.address)).to.eq(investmentOf.sub(removeInvestment));
            //totalInvestment
            await expect(await hotPotFund.totalInvestment()).to.eq(totalInvestment.sub(removeInvestment));
            //balanceOf
            await expect(await hotPotFund.balanceOf(depositor.address)).to.eq(expectedShareAmount);
        }
    }

    it('withdraw: half of amount before investing', withdraw(async () => {
        const withdrawRatio = 2;//50%
        const withdrawAmount = expectedDepositAmount.div(withdrawRatio);
        expectedWithdrawAmount = expectedWithdrawAmount.add(withdrawAmount);
        expectedDepositAmount = expectedDepositAmount.sub(withdrawAmount);
        const shareAmount = expectedShareAmount.div(withdrawRatio);
        expectedShareAmount = expectedShareAmount.sub(shareAmount);
        return {shareAmount, isCurve: false};
    }));

    function setSwapPath(builder: () => any) {
        return async () => {
            if (investToken.address == fixture.tokenWETH.address) return;

            const {tokenIn, tokenOut, path} = await builder();
            //Non-Controller operation
            await expect(hotPotFund.connect(depositor).setSwapPath(tokenIn.address, tokenOut.address, path))
                .to.be.revertedWith("Only called by Controller.");

            //DAi->USDC = Uniswap(0)
            await expect(controller.connect(manager).setSwapPath(hotPotFund.address, tokenIn.address, tokenOut.address, path))
                .to.not.be.reverted;
        };
    }

    it('setSwapPath: Uniswap before investing', setSwapPath(async () => {
        return {
            tokenIn: investToken,
            tokenOut: tokens[0],
            path: 1 //Uniswap(0) Curve(1)
        }
    }));

    it('invest: after add pair', invest(async () => {
        await sleep(1);
        return {amount: expectedDepositAmount}
    }));

    it('mineUNIAll: after investing', async () => {
        await sleep(1);
        await expect(controller.mineUNIAll(hotPotFund.address))
            .to.not.be.reverted;

        //Non-Controller operation
        await expect(hotPotFund.mineUNIAll())
            .to.be.revertedWith("Only called by Controller.");
    });

    it("deposit: remaining all", deposit(async () => {
        await sleep(1);
        const depositAmount = INIT_DEPOSIT_AMOUNT.sub(expectedDepositAmount).sub(expectedWithdrawAmount);
        expectedDepositAmount = expectedDepositAmount.add(depositAmount);
        const sumAssets = await calSumAssets();
        const share = sumAssets.gt(0) ? depositAmount.mul(expectedShareAmount).div(sumAssets) : depositAmount;
        expectedShareAmount = expectedShareAmount.add(share);
        return {depositAmount};
    }));

    it('withdraw: after investing and mining UNI', withdraw(async () => {
        const periodFinish = await fixture.uniStakingRewardsDAI.periodFinish();
        await sleep(periodFinish.sub(Math.floor(new Date().getTime() / 1e3)).toNumber());
        const withdrawRatio = 2;//50%
        const withdrawAmount = expectedDepositAmount.div(withdrawRatio);
        expectedWithdrawAmount = expectedWithdrawAmount.add(withdrawAmount);
        expectedDepositAmount = expectedDepositAmount.sub(withdrawAmount);
        const shareAmount = expectedShareAmount.div(withdrawRatio);
        expectedShareAmount = expectedShareAmount.sub(shareAmount);
        return {shareAmount, isCurve: false};
    }));

    it('setSwapPath: Curve before reBalance', setSwapPath(async () => {
        return {
            tokenIn: investToken,
            tokenOut: tokens[0],
            path: 1 //Uniswap(0) Curve(1)
        }
    }));


    async function pairLiquidityOf(pair: Contract, pairIndex: number) {
        pair = pair || await getPair(fixture.factory, investToken.address, tokens[pairIndex].address);
        const availableLP = await pair.balanceOf(hotPotFund.address);
        const stackingLP = await hotPotFund.stakingLPOf(pair.address);
        return availableLP.add(stackingLP);
    }

    function reBalance(builder: () => any) {
        return async () => {
            const {addIndex, removeIndex, removeRatio} = await builder();
            const fundTokenAddr = hotPotFund.token ? await hotPotFund.token() : fixture.tokenWETH.address;

            const removeTokenAddr = await hotPotFund.pairs(removeIndex);
            const removePair = await getPair(fixture.factory, fundTokenAddr, removeTokenAddr);
            const removePairLiquidity = await pairLiquidityOf(removePair, removeIndex);

            const removeLiquidity = removePairLiquidity.div(removeRatio);// MINIMUM_LIQUIDITY = 1000

            //Non-Controller operation
            await expect(hotPotFund.connect(depositor).reBalance(addIndex, removeIndex, removeLiquidity))
                .to.be.revertedWith("Only called by Controller.");

            //error index
            await expect(controller.reBalance(hotPotFund.address, 1, 5, 101))
                .to.be.revertedWith("Pairs index out of range.");
            //error liquidity
            await expect(controller.reBalance(hotPotFund.address, addIndex, removeIndex, MaxUint256))
                .to.be.revertedWith("Not enough liquidity.");

            //reBalance
            let transaction = await controller.connect(manager).reBalance(hotPotFund.address, addIndex, removeIndex, removeLiquidity);
            printGasLimit(transaction, "reBalance");
            await expect(Promise.resolve(transaction)).to.not.be.reverted;
        }
    }

    const addIndex = 0;
    const removeIndex = 1;

    it('reBalance: remove half of pair_1 liquidity', reBalance(async () => {
        await sleep(1);
        // await printPairsStatus(hotPotFund);
        return {addIndex: addIndex, removeIndex: removeIndex, removeRatio: 2};
    }));

    it("removePair: remove pair_1", async () => {
        await sleep(1);
        // await printPairsStatus(hotPotFund);
        await expect(controller.connect(manager).removePair(hotPotFund.address, 1e4))
            .to.be.revertedWith("Pairs index out of range.");
        const transaction = await controller.connect(manager).removePair(hotPotFund.address, removeIndex);
        printGasLimit(transaction, "removePair");
        if (investToken.address != fixture.tokenWETH.address) {
            await expect(Promise.resolve(transaction))
                .to.emit(tokens[removeIndex], "Approval")
                .withArgs(hotPotFund.address, fixture.router.address, 0)
                .to.emit(tokens[removeIndex], "Approval")
                .withArgs(hotPotFund.address, fixture.curve.address, 0)
        } else {
            await expect(Promise.resolve(transaction))
                .to.emit(tokens[removeIndex], "Approval")
                .withArgs(hotPotFund.address, fixture.router.address, 0);
        }
    });

    it("addPair: add pair_1 again", async () => {
        await sleep(1);
        // await printPairsStatus(hotPotFund);

        // console.log(`tokens[${removeIndex}] approve hotPotFund to router balance: ${await tokens[removeIndex].allowance(hotPotFund.address, fixture.router.address)}`);
        // console.log(`tokens[${removeIndex}] approve hotPotFund to curve  balance: ${await tokens[removeIndex].allowance(hotPotFund.address, fixture.curve.address)}`);

        const transaction = await controller.addPair(hotPotFund.address, tokens[removeIndex].address);
        printGasLimit(transaction, "addPair");
        await expect(Promise.resolve(transaction)).to.not.be.reverted;
    });
});
