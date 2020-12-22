import chai, {expect} from 'chai'
import {Contract} from 'ethers'
import {BigNumber, bigNumberify,} from 'ethers/utils'
import {MaxUint256} from 'ethers/constants'
import {createFixtureLoader, MockProvider, solidity,} from 'ethereum-waffle'

import {expandTo18Decimals, expandTo6Decimals, getTransactionTimestamp, printGasLimit, sleep} from './shared/utilities'

import {
    depositHotPotFund,
    depositHotPotFundETH,
    HotPotFixture,
    INIT_STAKE_REWARDS_AMOUNT,
    readStatus
} from './shared/fixtures'

chai.use(require('chai-shallow-deep-equal'));
chai.use(solidity);

const INIT_DEPOSITOR_MINT_AMOUNT_18 = expandTo18Decimals(1e4);
const INIT_DEPOSITOR_MINT_AMOUNT_6 = expandTo6Decimals(1e4);
const INIT_DEPOSIT_FUND_ACCOUNT_18 = expandTo18Decimals(2e3);
const INIT_DEPOSIT_FUND_ACCOUNT_6 = expandTo6Decimals(2e3);

const REWARDS_DURATION = bigNumberify(30);//60 * 24 * 3600
let REWARD_RATE = bigNumberify(0);
let REWARD_PER_TOKEN_STORED = bigNumberify(0);
let USER_REWARD_PER_TOKEN_PAID: any = {};
let PERIOD_FINISH = bigNumberify(0);
let LAST_UPDATE_TIME = bigNumberify(0);
let REWARDS: any = {};
// staking token balance
let STAKE_TOTAL = bigNumberify(0);
let STAKE_BALANCE_OF: any = {};
let TxTimestamp = bigNumberify(0);

const overrides = {
    gasLimit: 9999999
};


describe('StakingRewards', () => {
    const provider = new MockProvider({
        hardfork: 'istanbul',
        mnemonic: 'hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot',
        gasLimit: 9999999
    });
    const [deployer, depositor, trader, other] = provider.getWallets();
    const loadFixture = createFixtureLoader(provider, [deployer]);
    let fixture: HotPotFixture;
    let tokenWETH: Contract;
    let rewardsToken: Contract;
    let stakingRewards: Contract;
    let stakingToken: Contract;
    let investToken: Contract;

    async function initStatus(token: Contract, hotPotFund: Contract,
                              wallet: any, mintAmount: BigNumber, depositAmount: BigNumber) {
        if (tokenWETH.address != token.address) {
            //mint token for testing
            await token._mint_for_testing(wallet.address, mintAmount);
            //deposit hotPotFund for LP staking token
            await depositHotPotFund(hotPotFund, token, wallet, depositAmount);
        } else {
            //mint token for testing
            await token.connect(wallet).deposit({value: mintAmount});
            //deposit hotPotFund for LP staking token
            await depositHotPotFundETH(hotPotFund, wallet, depositAmount);
        }

        // init local actual case data
        STAKE_BALANCE_OF[depositor.address] = bigNumberify(0);
        REWARDS[depositor.address] = bigNumberify(0);
        USER_REWARD_PER_TOKEN_PAID[depositor.address] = bigNumberify(0);
    }

    function getLastTimeRewardApplicable(isRealTime?: boolean) {
        return PERIOD_FINISH.lte(TxTimestamp) ? PERIOD_FINISH : TxTimestamp;
    }

    function getRewardPerToken(isRealTime?: boolean) {
        if (STAKE_TOTAL.eq(0)) {
            return REWARD_PER_TOKEN_STORED;
        }
        return REWARD_PER_TOKEN_STORED.add(
            getLastTimeRewardApplicable(isRealTime).sub(LAST_UPDATE_TIME)
                .mul(REWARD_RATE).mul(expandTo18Decimals(1)).div(STAKE_TOTAL)
        );
    }

    function getRewardForDuration() {
        return REWARD_RATE.mul(REWARDS_DURATION);
    }

    function getEarned(account: string) {
        return STAKE_BALANCE_OF[account].mul(getRewardPerToken().sub(USER_REWARD_PER_TOKEN_PAID[account]))
            .div(expandTo18Decimals(1)).add(REWARDS[account]);
    }

    async function updateReward(txHash: string, account?: string) {
        TxTimestamp = await getTransactionTimestamp(provider, txHash);
        REWARD_PER_TOKEN_STORED = getRewardPerToken();
        LAST_UPDATE_TIME = getLastTimeRewardApplicable();
        if (account) {
            REWARDS[account] = getEarned(account);
            USER_REWARD_PER_TOKEN_PAID[account] = REWARD_PER_TOKEN_STORED;
        }
        // console.log(`LOCAL REWARDS:`, REWARDS);
        // console.log(`LOCAL USER_REWARD_PER_TOKEN_PAID:`, USER_REWARD_PER_TOKEN_PAID);
        // console.log(`LOCAL STAKE_BALANCE_OF:`, STAKE_BALANCE_OF);
        // console.log(`LOCAL REWARD_RATE:`, REWARD_RATE);
        // console.log(`LOCAL REWARD_PER_TOKEN_STORED:`, REWARD_PER_TOKEN_STORED);
        // console.log(`TxTimestamp:`, TxTimestamp);
        // console.log(`PERIOD_FINISH:`, PERIOD_FINISH);
    }

    before(async () => {
        fixture = await loadFixture(HotPotFixture);
        tokenWETH = fixture.tokenWETH;
        rewardsToken = fixture.tokenHotPot;

        const TOKEN_TYPE = "DAI";//case DAI/USDC/USDT/SUSD/ETH
        stakingRewards = (<any>fixture)["stakingRewards" + TOKEN_TYPE];
        stakingToken = (<any>fixture)["hotPotFund" + TOKEN_TYPE];
        investToken = (<any>fixture)["token" + TOKEN_TYPE];

        const mintAmount = await investToken.decimals() == 18 ? INIT_DEPOSITOR_MINT_AMOUNT_18 : INIT_DEPOSITOR_MINT_AMOUNT_6;
        const depositAmount = await investToken.decimals() == 18 ? INIT_DEPOSIT_FUND_ACCOUNT_18 : INIT_DEPOSIT_FUND_ACCOUNT_6;

        await initStatus(investToken, stakingToken, depositor, mintAmount, depositAmount);
    });

    beforeEach(async () => {
        Object.keys(fixture).forEach(key => {
            (fixture as any)[key].connect(deployer);
        });
    });

    //rewardsToken, stakingToken, periodFinish, rewardRate, rewardsDuration, ' +
    //'lastUpdateTime, rewardPerTokenStored, userRewardPerTokenPaid, rewards
    it('readInitStatus', readStatus(() => {
        return {
            target: stakingRewards,
            caseData: {
                rewardsToken: {
                    value: rewardsToken.address
                },
                stakingToken: {
                    value: stakingToken.address
                },
                periodFinish: {
                    value: 0
                },
                rewardRate: {
                    value: 0
                },
                rewardsDuration: {
                    value: REWARDS_DURATION
                },
                lastUpdateTime: {
                    value: 0
                },
                rewardPerTokenStored: {
                    value: 0
                },
                userRewardPerTokenPaid: {
                    args: [depositor.address],
                    value: 0
                },
                rewards: {
                    args: [depositor.address],
                    value: 0
                },
                totalSupply: {
                    value: 0
                },
                balanceOf: {
                    args: [depositor.address],
                    value: 0
                },
                lastTimeRewardApplicable: {
                    value: 0
                },
                rewardPerToken: {
                    value: 0
                },
                earned: {
                    args: [depositor.address],
                    value: 0
                },
                getRewardForDuration: {
                    value: 0
                }
            }
        }
    }));


    function notifyRewardAmount(builder: () => any) {
        return async () => {
            const {stakingRewards, rewardsToken, rewardsAmount} = await builder();

            const remaining = await rewardsToken.balanceOf(stakingRewards.address);
            // transfer rewards to stakingRewards
            await expect(rewardsToken.transfer(stakingRewards.address, rewardsAmount))
                .to.emit(rewardsToken, 'Transfer')
                .withArgs(deployer.address, stakingRewards.address, rewardsAmount);
            // read balanceOf
            await expect(await rewardsToken.balanceOf(stakingRewards.address))
                .to.eq(remaining.add(rewardsAmount));

            // Non-RewardsDistribution operation
            await expect(stakingRewards.connect(depositor).notifyRewardAmount(rewardsAmount))
                .to.be.revertedWith("Caller is not RewardsDistribution contract");

            // notifyRewardAmount
            let transaction: any = await stakingRewards.notifyRewardAmount(rewardsAmount);
            printGasLimit(transaction, "notifyRewardAmount");

            //update local actual case data
            await updateReward(transaction.hash);
            if (TxTimestamp.gte(PERIOD_FINISH)) {
                REWARD_RATE = rewardsAmount.div(REWARDS_DURATION);
            } else {
                const remaining = PERIOD_FINISH.sub(TxTimestamp);
                const leftover = remaining.mul(REWARD_RATE);
                REWARD_RATE = rewardsAmount.add(leftover).div(REWARDS_DURATION);
            }
            LAST_UPDATE_TIME = TxTimestamp;
            PERIOD_FINISH = LAST_UPDATE_TIME.add(REWARDS_DURATION);

            //event analysis
            await expect(Promise.resolve(transaction))
                .to.emit(stakingRewards, 'RewardAdded')
                .withArgs(rewardsAmount);

            // read stakingRewards status
            await readStatus(() => {
                    return {
                        target: stakingRewards,
                        caseData: {
                            earned: {
                                args: [depositor.address],
                                value: getEarned(depositor.address)
                            },
                            periodFinish: {
                                value: PERIOD_FINISH
                            },
                            rewardRate: {
                                value: REWARD_RATE
                            },
                            lastUpdateTime: {
                                value: LAST_UPDATE_TIME
                            },
                            rewardPerTokenStored: {
                                value: REWARD_PER_TOKEN_STORED
                            },
                            userRewardPerTokenPaid: {
                                args: [depositor.address],
                                value: USER_REWARD_PER_TOKEN_PAID[depositor.address]
                            },
                            rewards: {
                                args: [depositor.address],
                                value: REWARDS[depositor.address]
                            },
                            totalSupply: {
                                value: STAKE_TOTAL
                            },
                            balanceOf: {
                                args: [depositor.address],
                                value: STAKE_BALANCE_OF[depositor.address]
                            },
                            lastTimeRewardApplicable: {
                                value: getLastTimeRewardApplicable()
                            },
                            rewardPerToken: {
                                value: getRewardPerToken()
                            },
                            getRewardForDuration: {
                                value: getRewardForDuration()
                            },
                        }
                    }
                }
            )();
        }
    }

    it('notifyReward: init', notifyRewardAmount(async () => {
        stakingRewards = stakingRewards.connect(deployer);
        rewardsToken = rewardsToken.connect(deployer);
        const rewardsAmount = INIT_STAKE_REWARDS_AMOUNT;
        return {stakingRewards, rewardsToken, rewardsAmount};
    }));

    // function stake(uint256 amount) external nonReentrant updateReward(msg.sender)
    function stake(builder: () => any) {
        return async () => {
            const {stakingRewards, stakingToken, stakeAmount} = await builder();

            //approve transfer
            await expect(stakingToken.approve(stakingRewards.address, MaxUint256)).to.not.be.reverted;

            //stake 0
            await expect(stakingRewards.stake(0))
                .to.be.revertedWith("Cannot stake 0");
            //stake
            const transaction = await stakingRewards.stake(stakeAmount);
            printGasLimit(transaction, "stake");

            // update local actual case data
            await updateReward(transaction.hash, depositor.address);
            STAKE_TOTAL = STAKE_TOTAL.add(stakeAmount);
            STAKE_BALANCE_OF[depositor.address] = STAKE_BALANCE_OF[depositor.address].add(stakeAmount);

            //event analysis
            await expect(Promise.resolve(transaction))
                //stakingToken Transfer
                .to.emit(stakingToken, "Transfer")
                .withArgs(depositor.address, stakingRewards.address, stakeAmount)
                //stakingRewards Staked
                .to.emit(stakingRewards, "Staked")
                .withArgs(depositor.address, stakeAmount);
        };
    }

    it('stake: init', stake(async () => {
        stakingRewards = stakingRewards.connect(depositor);
        stakingToken = stakingToken.connect(depositor);
        await sleep(1);
        const stakeAmount = (await stakingToken.balanceOf(depositor.address)).div(2);
        console.log(`stakeAmount：${stakeAmount}`);
        return {stakingRewards, stakingToken, stakeAmount};
    }));

    it('notifyReward: again', notifyRewardAmount(async () => {
        stakingRewards = stakingRewards.connect(deployer);
        rewardsToken = rewardsToken.connect(deployer);
        const rewardsAmount = INIT_STAKE_REWARDS_AMOUNT;
        await sleep(1);
        return {stakingRewards, rewardsToken, rewardsAmount};
    }));

    // function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender)
    function withdraw(builder: () => any) {
        return async () => {
            const {stakingRewards, stakingToken, removeAmount} = await builder();

            await expect(removeAmount.gt(bigNumberify(0))).to.be.true;
            //stake 0
            await expect(stakingRewards.withdraw(0))
                .to.be.revertedWith("Cannot withdraw 0");

            //stake stakeAmount
            const transaction = await stakingRewards.withdraw(removeAmount);
            printGasLimit(transaction, "withdraw");

            // update local actual case data
            await updateReward(transaction.hash, depositor.address);
            STAKE_TOTAL = STAKE_TOTAL.sub(removeAmount);
            STAKE_BALANCE_OF[depositor.address] = STAKE_BALANCE_OF[depositor.address].sub(removeAmount);

            //event analysis
            await expect(Promise.resolve(transaction))
                //stakingToken Transfer
                .to.emit(stakingToken, "Transfer")
                .withArgs(stakingRewards.address, depositor.address, removeAmount)
                //stakingRewards Withdrawn
                .to.emit(stakingRewards, "Withdrawn")
                .withArgs(depositor.address, removeAmount);

        };
    }

    it('withdraw', withdraw(async () => {
        stakingRewards = stakingRewards.connect(depositor);
        stakingToken = stakingToken.connect(depositor);
        await sleep(1);
        const stakeAmount = await stakingRewards.balanceOf(depositor.address);
        const removeAmount = stakeAmount.div(2);
        console.log(`removeAmount：${removeAmount}`);
        return {stakingRewards, stakingToken, stakeAmount, removeAmount};
    }));

    it('stake: again', stake(async () => {
        stakingRewards = stakingRewards.connect(depositor);
        stakingToken = stakingToken.connect(depositor);
        await sleep(1);
        const stakeAmount = (await stakingToken.balanceOf(depositor.address)).div(2);
        console.log(`stakeAmount：${stakeAmount}`);
        return {stakingRewards, stakingToken, stakeAmount};
    }));

    // function getReward() public nonReentrant updateReward(msg.sender)
    function getReward(builder: () => any) {
        return async () => {
            const {stakingRewards, rewardsToken} = await builder();

            const transaction = await stakingRewards.getReward();
            await expect(Promise.resolve(transaction)).to.not.be.reverted;

            // update local actual case data
            await updateReward(transaction.hash, depositor.address);
            const rewardsAmount = REWARDS[depositor.address];
            REWARDS[depositor.address] = bigNumberify(0);

            //event analysis
            if (rewardsAmount.gt(0)) {
                await expect(Promise.resolve(transaction))
                    //rewardsToken Transfer
                    .to.emit(rewardsToken, "Transfer")
                    .withArgs(stakingRewards.address, depositor.address, rewardsAmount)
                    //stakingRewards RewardPaid
                    .to.emit(stakingRewards, "RewardPaid")
                    .withArgs(depositor.address, rewardsAmount);
                printGasLimit(transaction, 'getReward have rewards');
            } else {
                printGasLimit(transaction, 'getReward no rewards');
            }
        };
    }

    it('getReward', getReward(async () => {
        stakingRewards = stakingRewards.connect(depositor);
        rewardsToken = rewardsToken.connect(depositor);
        await sleep(1);
        return {stakingRewards, rewardsToken};
    }));

    // function exit() external
    function exit(builder: () => any) {
        return async () => {
            const {stakingRewards, stakingToken, rewardsToken} = await builder();
            const stakeAmount = STAKE_BALANCE_OF[depositor.address];
            //must be stakeAmount>0
            await expect(stakeAmount.gt(bigNumberify(0))).to.be.true;
            //approve transfer
            await expect(stakingToken.approve(stakingRewards.address, MaxUint256)).to.not.be.reverted;

            //waiting timeout
            await sleep(30);

            const transaction = await stakingRewards.exit();
            // update local actual case data
            await updateReward(transaction.hash, depositor.address);
            const rewardsAmount = REWARDS[depositor.address];
            REWARDS[depositor.address] = bigNumberify(0);
            STAKE_TOTAL = STAKE_TOTAL.sub(stakeAmount);
            STAKE_BALANCE_OF[depositor.address] = STAKE_BALANCE_OF[depositor.address].sub(stakeAmount);

            //event analysis
            if (rewardsAmount.gt(0)) {
                await expect(Promise.resolve(transaction))
                    //stakingToken Transfer
                    .to.emit(stakingToken, "Transfer")
                    .withArgs(stakingRewards.address, depositor.address, stakeAmount)
                    //stakingRewards Withdrawn
                    .to.emit(stakingRewards, "Withdrawn")
                    .withArgs(depositor.address, stakeAmount)

                    //rewardsToken Transfer
                    .to.emit(rewardsToken, "Transfer")
                    .withArgs(stakingRewards.address, depositor.address, rewardsAmount)
                    //stakingRewards RewardPaid
                    .to.emit(stakingRewards, "RewardPaid")
                    .withArgs(depositor.address, rewardsAmount);
                printGasLimit(transaction, 'exit have rewards');
            } else {
                await expect(Promise.resolve(transaction))
                    //stakingToken Transfer
                    .to.emit(stakingToken, "Transfer")
                    .withArgs(stakingRewards.address, depositor.address, stakeAmount)
                    //stakingRewards Withdrawn
                    .to.emit(stakingRewards, "Withdrawn")
                    .withArgs(depositor.address, stakeAmount);
                printGasLimit(transaction, 'exit no rewards');
            }
        }
    }

    it('exit', exit(async () => {
        stakingRewards = stakingRewards.connect(depositor);
        stakingToken = stakingToken.connect(depositor);
        rewardsToken = rewardsToken.connect(depositor);
        await sleep(1);
        const stakeAmount = (await stakingRewards.balanceOf(depositor.address));
        return {stakingRewards, stakingToken, rewardsToken, stakeAmount};
    }));

    // it('send ETH', async () => {
    //     console.log(`time:${new Date().toLocaleString()}`);
    //     let transactionResponse1 = await deployer.sendTransaction({
    //         to: depositor.address,
    //         value: expandTo18Decimals(1)
    //     });
    //     console.log(`time:${new Date().toLocaleString()}`);
    //     let transactionResponse2 = await deployer.sendTransaction({
    //         to: depositor.address,
    //         value: expandTo18Decimals(2)
    //     });
    //     console.log(`time:${new Date().toLocaleString()}`);
    //     console.log(`tx1:`, await getTransactionTimestamp(provider, transactionResponse1.hash as string));
    //     console.log(`time:${new Date().toLocaleString()}`);
    //     console.log(`tx2:`, await getTransactionTimestamp(provider, transactionResponse2.hash as string));
    //     console.log(`time:${new Date().toLocaleString()}`);
    // });
});
