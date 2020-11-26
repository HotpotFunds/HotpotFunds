import {BigNumber, bigNumberify} from 'ethers/utils'
import {Web3Provider} from 'ethers/providers'

export async function getTransactionTimestamp(provider: Web3Provider, txhash: string) {
    const rs = await provider.getTransaction(txhash);
    const {timestamp} = await provider.getBlock(rs.blockNumber as number);
    return bigNumberify(timestamp);
}

export async function sleep(second: number) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, second * 1e3);
    })
}

export function printGasLimit(transaction: any, tag?: string) {
    console.log(`gasLimit${!tag ? "" : "-" + tag}: ${transaction.gasLimit}`);
}

export function expandTo18Decimals(n: number): BigNumber {
  return bigNumberify(n).mul(bigNumberify(10).pow(18))
}

export function expandTo6Decimals(n: number): BigNumber {
  return bigNumberify(n).mul(bigNumberify(10).pow(6))
}

