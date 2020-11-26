pragma solidity >=0.5.0;

import '../libraries/SafeMath.sol';
import '../libraries/SafeERC20.sol';
import '../interfaces/IERC20.sol';

contract CurveMock {
    using SafeMath for uint;
    using SafeERC20 for IERC20;
    address public owner;

    uint public N_COINS;
    address[] public coins;
    uint public  PRECISION = 1e18;

    constructor(address[] memory _coins) public{
        coins = _coins;
        N_COINS = coins.length;
        owner = msg.sender;
    }

    function reSetCoin(uint index, address coin) external{
        coins[index] = coin;
    }

    function exchange(int128 inIndex, int128 outIndex, uint256 inAmount, uint256 minOut) external{
        //Use the ratio of the current balance to calculate the exchange rate
        uint outAmount = inAmount * IERC20(coins[uint(outIndex)]).balanceOf(address(this))/IERC20(coins[uint(inIndex)]).balanceOf(address(this));

        require(outAmount >= minOut, "Exchange resulted in fewer coins than expected");

        IERC20(coins[uint(inIndex)]).safeTransferFrom(msg.sender, address(this), inAmount);
        IERC20(coins[uint(outIndex)]).safeTransfer(msg.sender, outAmount);
    }
}
