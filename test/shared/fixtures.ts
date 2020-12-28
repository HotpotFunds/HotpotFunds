import {Contract, Wallet} from 'ethers'
import {BigNumber} from 'ethers/utils'

import {Web3Provider} from 'ethers/providers'
import {deployContract} from 'ethereum-waffle'

import {expandTo18Decimals, expandTo6Decimals} from './utilities'
import {MaxUint256} from 'ethers/constants'

import ERC20Mock from '../../build/ERC20Mock.json'
import ERC20MockNoReturn from '../../build/ERC20MockNoReturn.json'
import WETH from '../../build/WETH9.json'
import HotPotERC20 from '../../build/HotPot.json'

import CurveMock from '../../build/CurveMock.json'
import UniswapV2Factory from '@uniswap/v2-core/build/UniswapV2Factory.json'
import UniswapV2Router02 from '@uniswap/v2-periphery/build/UniswapV2Router02.json'
import IUniswapV2Pair from '@uniswap/v2-core/build/IUniswapV2Pair.json'

import HotPotController from '../../build/HotPotControllerMock.json';
import HotPotFund from '../../build/HotPotFundMock.json';
import HotPotFundETH from '../../build/HotPotFundETHMock.json';
import StakingRewards from '../../build/StakingRewardsMock.json';
import chai, {expect} from "chai";

chai.use(require('chai-shallow-deep-equal'));

const overrides = {
    gasLimit: 9999999
};

export const INIT_FOR_TEST_WETH_AMOUNT = expandTo18Decimals(1000 * 1e4);
export const INIT_FOR_TEST_TOKEN_AMOUNT_18 = expandTo18Decimals(1000 * 1e4);
export const INIT_FOR_TEST_TOKEN_AMOUNT_6 = expandTo6Decimals(1000 * 1e4);
export const INIT_ETH_USD_PRICE = 1000;
export const INIT_PAIR_LP_AMOUNT_18 = expandTo18Decimals(1e4);
export const INIT_PAIR_LP_AMOUNT_6 = expandTo6Decimals(1e4);
export const INIT_PAIR_LP_AMOUNT_ETH = expandTo18Decimals(1e4 / INIT_ETH_USD_PRICE);
export const INIT_STAKE_REWARDS_AMOUNT = expandTo18Decimals(15 * 1e4);

export interface HotPotFixture {
    tokenDAI: Contract,
    tokenUSDC: Contract,
    tokenUSDT: Contract,
    tokenWETH: Contract,
    tokenETH: Contract,
    tokenUNI: Contract,
    tokenHotPot: Contract,

    curve: Contract,
    factory: Contract,
    router: Contract,

    hotPotController: Contract,

    hotPotFundDAI: Contract,
    hotPotFundUSDC: Contract,
    hotPotFundUSDT: Contract,
    hotPotFundETH: Contract,

    stakingRewardsDAI: Contract,
    stakingRewardsUSDC: Contract,
    stakingRewardsUSDT: Contract,
    stakingRewardsETH: Contract,

    uniStakingRewardsDAI: Contract,
    uniStakingRewardsUSDC: Contract,
    uniStakingRewardsUSDT: Contract,
}

const TOKEN_TYPE = {
    DAI: {
        name: "DAI",
        symbol: "DAI",
        decimal: 18,
    },
    USDC: {
        name: "USDC",
        symbol: "USDC",
        decimal: 6,
    },
    USDT: {
        name: "USDT",
        symbol: "USDT",
        decimal: 6,
    },
    SUSD: {
        name: "sUSD",
        symbol: "sUSD",
        decimal: 18,
    },
    WETH: {
        name: "WETH",
        symbol: "WETH",
        decimal: 18,
    },
    UNI: {
        name: "UNI",
        symbol: "UNI",
        decimal: 18,
    }
};

export async function getPair(factory: Contract, tokenIn: string, tokenOut: string): Promise<Contract> {
    const pairAddress = await factory.getPair(tokenIn, tokenOut);
    return new Contract(pairAddress, JSON.stringify(IUniswapV2Pair.abi), factory.provider);
}

export async function getAmountOut(factory: Contract, router: Contract,
                                   tokenIn: string, tokenOut: string, amountIn: any) {
    const pairAddress = await factory.getPair(tokenIn, tokenOut);
    const pair = new Contract(pairAddress, JSON.stringify(IUniswapV2Pair.abi), factory.provider);
    const {reserve0, reserve1} = await pair.getReserves();
    let amountOut;
    if (await pair.token0() == tokenIn) {
        amountOut = await router.getAmountOut(amountIn, reserve0, reserve1);
    } else {
        amountOut = await router.getAmountOut(amountIn, reserve1, reserve0);
    }
    return {amountOut, pair}
}

export async function printPairsStatus(hotPotFund: Contract) {
    const length = (await hotPotFund.pairsLength()).toNumber();
    for (let i = 0; i < length; i++) {
        console.log(`pair_${i}:${await hotPotFund.pairs(i)}`);
    }
}

export interface ContractCaseBuilder {
    target: Contract;
    caseData: {
        [item: string]: {
            args?: any;
            symbol?: any,
            value: any;
        } | Array<{
            args?: any;
            symbol?: any,
            value: any;
        }>
    };
}

export function readStatus(builder: () => ContractCaseBuilder) {
    return async () => {
        const {target, caseData} = await builder();
        const keys = Object.keys(caseData);
        for (const key of keys) {
            if (Array.isArray(caseData[key])) {
                for (let child of caseData[key] as any) {
                    if (child.args) {
                        // @ts-ignore
                        await expect(await target[key](...child.args)).to[child.symbol ? child.symbol : "eq"](child.value)
                    } else {
                        // @ts-ignore
                        await expect(await target[key]()).to[child.symbol ? child.symbol : "eq"](child.value)
                    }
                }
            }
            // @ts-ignore
            else if (caseData[key].args) {
                // @ts-ignore
                await expect(await target[key](...caseData[key].args)).to[caseData[key].symbol ? caseData[key].symbol : "eq"](caseData[key].value)
            } else {
                // @ts-ignore
                await expect(await target[key]()).to[caseData[key].symbol ? caseData[key].symbol : "eq"](caseData[key].value)
            }
        }
    }
}

export async function depositHotPotFund(hotPotFund: Contract, token: Contract, depositor: any, amount: BigNumber) {
    //approve hotPotFund transfer investing token
    await token.connect(depositor).approve(hotPotFund.address, 0);//避免USDT，需要清零的问题
    await token.connect(depositor).approve(hotPotFund.address, MaxUint256);
    //deposit investing token to hotPotFund
    await expect(hotPotFund.connect(depositor).deposit(amount)).to.not.be.reverted;
}

export async function depositHotPotFundETH(hotPotFund: Contract, depositor: any, amount: BigNumber) {
    //deposit investing ETH to hotPotFundETH
    await expect(hotPotFund.connect(depositor).deposit({value: amount})).to.not.be.reverted;
}

export async function mintAndDepositHotPotFund(hotPotFund: Contract, token: Contract, depositor: any, mintAmount: BigNumber, depositAmount?: BigNumber) {
    depositAmount = depositAmount ? depositAmount : mintAmount;
    if (await token.symbol() != "WETH") {
        //mint token for testing
        await token._mint_for_testing(depositor.address, mintAmount);
        await depositHotPotFund(hotPotFund, token, depositor, depositAmount);
    } else {
        //mint token for testing
        await token.connect(depositor).deposit({value: mintAmount});
        //deposit INIT_DEPOSIT_AMOUNT ETH to hotPotFundETH for invest
        await depositHotPotFundETH(hotPotFund, depositor, depositAmount);
    }
}


export async function HotPotFixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<HotPotFixture> {
    // deploy tokens: DAI、USDT、USDC、sUSD、WETH、HotPot
    const tokenDAI = await deployContract(wallet, ERC20Mock, [TOKEN_TYPE.DAI.name, TOKEN_TYPE.DAI.symbol, TOKEN_TYPE.DAI.decimal], overrides);
    const tokenUSDC = await deployContract(wallet, ERC20Mock, [TOKEN_TYPE.USDC.name, TOKEN_TYPE.USDC.symbol, TOKEN_TYPE.USDC.decimal], overrides);
    const tokenUSDT = await deployContract(wallet, ERC20MockNoReturn, [TOKEN_TYPE.USDT.name, TOKEN_TYPE.USDT.symbol, TOKEN_TYPE.USDT.decimal], overrides);
    const tokenWETH = await deployContract(wallet, WETH, [], overrides);
    const tokenETH = tokenWETH;
    const tokenUNI = await deployContract(wallet, ERC20Mock, [TOKEN_TYPE.UNI.name, TOKEN_TYPE.UNI.symbol, TOKEN_TYPE.UNI.decimal], overrides);
    const tokenHotPot = await deployContract(wallet, HotPotERC20, [wallet.address], overrides);
    // mint test token for wallet
    await tokenDAI._mint_for_testing(wallet.address, INIT_FOR_TEST_TOKEN_AMOUNT_18);
    await tokenUSDC._mint_for_testing(wallet.address, INIT_FOR_TEST_TOKEN_AMOUNT_6);
    await tokenUSDT._mint_for_testing(wallet.address, INIT_FOR_TEST_TOKEN_AMOUNT_6);
    await tokenUNI._mint_for_testing(wallet.address, INIT_FOR_TEST_TOKEN_AMOUNT_18);
    await tokenWETH.deposit({...overrides, value: INIT_FOR_TEST_WETH_AMOUNT});

    // deploy uniswapV2
    const factory = await deployContract(wallet, UniswapV2Factory, [wallet.address], overrides);
    // deploy uniswapV2 routers
    const router = await deployContract(wallet, UniswapV2Router02, [factory.address, tokenWETH.address], overrides);

    // deploy curve
    const curve = await deployContract(wallet, CurveMock, [[tokenDAI.address, tokenUSDC.address, tokenUSDT.address]], overrides);
    // initialize curve
    await tokenDAI._mint_for_testing(curve.address, expandTo18Decimals(1000 * 1e4));
    await tokenUSDC._mint_for_testing(curve.address, expandTo6Decimals(1000 * 1e4));
    await tokenUSDT._mint_for_testing(curve.address, expandTo6Decimals(1000 * 1e4));

    async function createPairWithEthAndInit(tokenA: Contract) {
        await factory.createPair(tokenA.address, tokenWETH.address, overrides);
        // const pairAddress = await factory.getPair(tokenA.address, tokenWETH.address);
        // const pair = new Contract(pairAddress, JSON.stringify(IUniswapV2Pair.abi), provider).connect(wallet);

        if (tokenUSDT.address == tokenA.address) await tokenA.approve(router.address, 0);
        await tokenA.approve(router.address, MaxUint256);

        const amountA = await tokenA.decimals() == 18 ? INIT_PAIR_LP_AMOUNT_18 : INIT_PAIR_LP_AMOUNT_6;

        await router.addLiquidityETH(
            tokenA.address,
            amountA,
            0,
            0,
            wallet.address,
            MaxUint256, {
                ...overrides,
                value: INIT_PAIR_LP_AMOUNT_ETH
            });
    }

    async function createPairAndInit(tokenA: Contract, tokenB: Contract) {
        await factory.createPair(tokenA.address, tokenB.address, overrides);
        // const pairAddress = await factory.getPair(tokenA.address, tokenB.address);
        // const pair = new Contract(pairAddress, JSON.stringify(IUniswapV2Pair.abi), provider).connect(wallet);

        if (tokenUSDT.address == tokenA.address) await tokenA.approve(router.address, 0);
        if (tokenUSDT.address == tokenB.address) await tokenB.approve(router.address, 0);
        await tokenA.approve(router.address, MaxUint256);
        await tokenB.approve(router.address, MaxUint256);
        const amountA = await tokenA.decimals() == 18 ? INIT_PAIR_LP_AMOUNT_18 : INIT_PAIR_LP_AMOUNT_6;
        const amountB = await tokenB.decimals() == 18 ? INIT_PAIR_LP_AMOUNT_18 : INIT_PAIR_LP_AMOUNT_6;

        await router.addLiquidity(
            tokenA.address,
            tokenB.address,
            amountA,
            amountB,
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
        );
    }

    // create 15 pairs
    // WETH-DAI、WETH-USDC、WETH-USDT、WETH-HotPot、
    await createPairWithEthAndInit(tokenDAI);
    await createPairWithEthAndInit(tokenUSDC);
    await createPairWithEthAndInit(tokenUSDT);
    await createPairWithEthAndInit(tokenHotPot);
    // DAI-USDC、DAI-USDT、DAI-HotPot、
    await createPairAndInit(tokenDAI, tokenUSDC);
    await createPairAndInit(tokenDAI, tokenUSDT);
    await createPairAndInit(tokenDAI, tokenHotPot);
    // USDC-USDT、USDC-HotPot、
    await createPairAndInit(tokenUSDC, tokenUSDT);
    await createPairAndInit(tokenUSDC, tokenHotPot);
    // USDT-HotPot、
    await createPairAndInit(tokenUSDT, tokenHotPot);

    // UNI stakingRewards
    const uniPool: any = {};
    async function addUniPool(token0: string, token1: string) {
        const pairAddr = await factory.getPair(token0, token1);
        uniPool[pairAddr] = await deployContract(wallet, StakingRewards,
            [wallet.address, tokenUNI.address, pairAddr], overrides);
        return uniPool[pairAddr];
    }

    const uniStakingRewardsDAI = await addUniPool(tokenWETH.address, tokenDAI.address);
    const uniStakingRewardsUSDC = await addUniPool(tokenWETH.address, tokenUSDC.address);
    const uniStakingRewardsUSDT = await addUniPool(tokenWETH.address, tokenUSDT.address);
    (factory as any)["uniPool"] = uniPool;

    // deploy HotPotController
    const hotPotController = await deployContract(wallet, HotPotController,
        [tokenHotPot.address, wallet.address, wallet.address, factory.address, router.address], overrides);
    // init trusted token list
    await hotPotController.setTrustedToken(tokenWETH.address, true);
    await hotPotController.setTrustedToken(tokenDAI.address, true);
    await hotPotController.setTrustedToken(tokenUSDC.address, true);
    await hotPotController.setTrustedToken(tokenUSDT.address, true);
    await hotPotController.setTrustedToken(tokenHotPot.address, true);
    // deploy HotPotFunds
    const commonInitArgs = [hotPotController.address, factory.address, router.address, tokenUNI.address];
    const hotPotFundDAI = await deployContract(wallet, HotPotFund,
        [tokenDAI.address, ...commonInitArgs], overrides);
    const hotPotFundUSDC = await deployContract(wallet, HotPotFund,
        [tokenUSDC.address, ...commonInitArgs], overrides);
    const hotPotFundUSDT = await deployContract(wallet, HotPotFund,
        [tokenUSDT.address, ...commonInitArgs], overrides);
    const hotPotFundETH = await deployContract(wallet, HotPotFundETH,
        [tokenWETH.address, ...commonInitArgs], overrides);

    // deploy stakingRewards
    const stakingRewardsDAI = await deployContract(wallet, StakingRewards,
        [wallet.address, tokenHotPot.address, hotPotFundDAI.address], overrides);
    const stakingRewardsUSDC = await deployContract(wallet, StakingRewards,
        [wallet.address, tokenHotPot.address, hotPotFundUSDC.address], overrides);
    const stakingRewardsUSDT = await deployContract(wallet, StakingRewards,
        [wallet.address, tokenHotPot.address, hotPotFundUSDT.address], overrides);
    const stakingRewardsETH = await deployContract(wallet, StakingRewards,
        [wallet.address, tokenHotPot.address, hotPotFundETH.address], overrides);

    return {
        tokenDAI,
        tokenUSDC,
        tokenUSDT,
        tokenWETH,
        tokenETH,
        tokenUNI,
        tokenHotPot,

        curve,
        factory,
        router,

        hotPotController,

        hotPotFundDAI,
        hotPotFundUSDC,
        hotPotFundUSDT,
        hotPotFundETH,

        stakingRewardsDAI,
        stakingRewardsUSDC,
        stakingRewardsUSDT,
        stakingRewardsETH,

        uniStakingRewardsDAI,
        uniStakingRewardsUSDC,
        uniStakingRewardsUSDT,
    }
}
