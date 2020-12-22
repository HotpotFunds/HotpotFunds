pragma solidity >=0.5.0;
import './IHotPotFund.sol';

interface IHotPotController {
    function hotpot() external view returns (address);
    function manager() external view returns (address);
    function governance() external view returns (address);
    function trustedToken(address token) external view returns (bool);

    function harvest(address token, uint amount) external returns(uint burned);

    function invest(address fund, uint amount) external;
    function addPair(address fund, address token, uint[] calldata proportions) external;
    function adjustPairs(address fund, uint[] calldata proportions) external;
    function removePair(address fund, uint index) external;
    function reBalance(address fund, uint add_index, uint remove_index, uint liquidity) external;
    function setSwapPath(address fund, address tokenIn, address tokenOut, IHotPotFund.SwapPath path) external;
    function mineUNI(address fund, address pair) external;
    function mineUNIAll(address fund) external;

    function setManager(address account) external;
    function setGovernance(address account) external;

    function setUNIPool(address fund, address pair, address uniPool) external;
    function setTrustedToken(address token, bool isTrusted) external;
}
