pragma solidity >=0.5.0;

interface IHotPotFund {
    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);
    event Deposit(address indexed owner, uint amount, uint share);
    event Withdraw(address indexed owner, uint amount, uint share);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint);
    function balanceOf(address owner) external view returns (uint);
    function allowance(address owner, address spender) external view returns (uint);

    function approve(address spender, uint value) external returns (bool);
    function transfer(address to, uint value) external returns (bool);
    function transferFrom(address from, address to, uint value) external returns (bool);

    function token() external view returns (address);
    function controller() external view returns (address);
    function assets(uint index) external view returns(uint);
    function totalAssets() external view returns (uint);
    function investmentOf(address owner) external view returns (uint);

    function totalDebts() external view returns (uint);
    function debtOf(address owner) external view returns (uint256);
    function uniPool(address pair) external view returns (address);

    function pairs(uint index) external view returns (address);
    function pairsLength() external view returns(uint);
    function paths(address tokenIn, address tokenOut) external view returns(uint);

    function deposit(uint amount) external returns(uint share);
    function withdraw(uint share) external returns(uint amount);

    function invest(uint amount, uint[] calldata proportions) external;
    function addPair(address _token) external;
    function removePair(uint index) external;
    function reBalance(uint add_index, uint remove_index, uint liquidity) external;
    function setCurvePool(address _token, address _curvePool, int128 N_COINS) external;

    function setUNIPool(address pair, address _uniPool) external;
    function mineUNI(address pair) external;
    function mineUNIAll() external;
}
