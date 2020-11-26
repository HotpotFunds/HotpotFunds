pragma solidity >=0.5.0;

interface IHotPotFund {
    enum SwapPath { UNISWAP, CURVE }

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
    function uniMintingPool(address pair) external view returns (address);

    function pools(uint index) external view returns (address, uint);
    function poolsLength() external view returns(uint);
    function paths(address tokenIn, address tokenOut) external view returns(uint);

    function deposit(uint amount) external returns(uint share);
    function withdraw(uint share) external returns(uint amount);

    function invest(uint amount) external;
    function addPool(address _token, uint _proportion) external;
    function adjustPool(uint up_index, uint down_index, uint proportion) external;
    function reBalance(uint add_index, uint remove_index, uint liquidity) external;
    function setSwapPath(address tokenIn, address tokenOut, SwapPath path) external;

    function setMintingUNIPool(address pair, address mintingPool) external;
    function stakeMintingUNI(address pair) external;
    function stakeMintingUNIAll() external;
}
