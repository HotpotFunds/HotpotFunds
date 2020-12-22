import chai, {expect} from 'chai'
import {Contract} from 'ethers'
import {MaxUint256} from 'ethers/constants'
import {createFixtureLoader, MockProvider, solidity} from 'ethereum-waffle'

import {expandTo18Decimals} from './shared/utilities'
import {HotPotFixture, INIT_FOR_TEST_TOKEN_AMOUNT_18} from "./shared/fixtures";

chai.use(solidity);

const TOTAL_SUPPLY = expandTo18Decimals(100 * 1e4);
const TEST_AMOUNT = expandTo18Decimals(10);


describe('HotPotFundERC20', () => {
    const provider = new MockProvider({
        hardfork: 'istanbul',
        mnemonic: 'hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot hotpot',
        gasLimit: 9999999
    });
    const [wallet, other] = provider.getWallets();
    let token: Contract;
    const loadFixture = createFixtureLoader(provider, [wallet]);

    let fixture: HotPotFixture;
    beforeEach(async () => {
        fixture = await loadFixture(HotPotFixture);
        await fixture.tokenDAI._mint_for_testing(wallet.address, INIT_FOR_TEST_TOKEN_AMOUNT_18);
        await fixture.tokenDAI.approve(fixture.hotPotFundDAI.address, MaxUint256);
        await fixture.hotPotFundDAI.deposit(TOTAL_SUPPLY);
        token = fixture.hotPotFundDAI;
    });

    it('name, symbol, decimals, totalSupply, balanceOf', async () => {
        const name = await token.name();
        expect(name).to.eq('Hotpot V1');
        expect(await token.symbol()).to.eq('HPT-V1');
        expect(await token.decimals()).to.eq(18);
        expect(await token.totalSupply()).to.eq(TOTAL_SUPPLY);
        expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY);
    });

    it('approve', async () => {
        //wallet approve to other amount = TEST_AMOUNT
        await expect(token.approve(other.address, TEST_AMOUNT))
            .to.emit(token, 'Approval')
            .withArgs(wallet.address, other.address, TEST_AMOUNT);

        //other allowance = TEST_AMOUNT
        expect(await token.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT);
    });

    it('transfer', async () => {
        //wallet transfer to other amount = TEST_AMOUNT
        await expect(token.transfer(other.address, TEST_AMOUNT))
            .to.emit(token, 'Transfer')
            .withArgs(wallet.address, other.address, TEST_AMOUNT);

        //wallet balanceOf=TOTAL_SUPPLY-TEST_AMOUNT
        expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT));

        //other balanceOf=TEST_AMOUNT
        expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT);
    });

    it('transfer:fail', async () => {
        //transfer amount > balance
        await expect(token.transfer(other.address, TOTAL_SUPPLY.add(1))).to.be.reverted;

        //transfer amount > balance
        await expect(token.connect(other).transfer(wallet.address, 1)).to.be.reverted;

        //self transfer amount > balance
        await expect(token.connect(other).transfer(other.address, 1)).to.be.reverted;
    });

    it('transferFrom', async () => {
        //approve TEST_AMOUNT
        await token.approve(other.address, TEST_AMOUNT);

        //transferFrom TEST_AMOUNT
        await expect(token.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
            .to.emit(token, 'Transfer')
            .withArgs(wallet.address, other.address, TEST_AMOUNT);

        //allowance = 0
        expect(await token.allowance(wallet.address, other.address)).to.eq(0);
        //sender balanceOf = TOTAL_SUPPLY - TEST_AMOUNT
        expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT));
        //receiver balanceOf = TEST_AMOUNT
        expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT);
    });

    it('transferFrom:max', async () => {
        //approve max
        await token.approve(other.address, MaxUint256);

        //transferFrom TEST_AMOUNT
        await expect(token.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
            .to.emit(token, 'Transfer')
            .withArgs(wallet.address, other.address, TEST_AMOUNT);

        //allowance = max - TEST_AMOUNT
        expect(await token.allowance(wallet.address, other.address)).to.eq(MaxUint256.sub(TEST_AMOUNT));
        //sender balanceOf = TOTAL_SUPPLY - TEST_AMOUNT
        expect(await token.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT));
        //receiver balanceOf = TEST_AMOUNT
        expect(await token.balanceOf(other.address)).to.eq(TEST_AMOUNT)
    });
});
