pragma solidity >=0.5.0;

import '../interfaces/IERC20.sol';
import '../interfaces/IUniswapV2Factory.sol';
import '../interfaces/IUniswapV2Router.sol';
import '../interfaces/IUniswapV2Pair.sol';
import '../interfaces/IStakingRewards.sol';
import '../interfaces/ICurve.sol';
import '../libraries/SafeMath.sol';
import '../libraries/SafeERC20.sol';
import '../HotPotFundERC20.sol';
import '../ReentrancyGuard.sol';

contract HotPotFundMock is ReentrancyGuard, HotPotFundERC20 {
    using SafeMath for uint;
    using SafeERC20 for IERC20;

    address public UNISWAP_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;
    address public UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address public CURVE_FI = 0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7;
    address public UNI = 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984;

    uint constant DIVISOR = 100;
    uint constant FEE = 20;

    mapping (address => int128) public curve_tokenID;

    address public token;
    address public controller;
    uint public totalInvestment;
    mapping (address => uint) public investmentOf;

    // UNI mining rewards
    uint public totalDebts;
    mapping(address => uint256) public debtOf;
    // UNI mining pool pair->minting pool
    mapping(address => address) public uniPool;

    struct Pair {
        address token;
        uint proportion;
    }
    Pair[] public pairs;

    enum SwapPath { UNISWAP, CURVE }
    mapping (address => mapping (address => SwapPath)) public paths;

    modifier onlyController() {
        require(msg.sender == controller, 'Only called by Controller.');
        _;
    }

    event Deposit(address indexed owner, uint amount, uint share);
    event Withdraw(address indexed owner, uint amount, uint share);


    constructor (address _token, address _controller,
                address _UNISWAP_FACTORY, address _UNISWAP_V2_ROUTER, address _CURVE_FI, address _UNI,
                address dai, address usdc, address usdt) public {
        UNISWAP_FACTORY = _UNISWAP_FACTORY;
        UNISWAP_V2_ROUTER = _UNISWAP_V2_ROUTER;
        CURVE_FI = _CURVE_FI;
        UNI = _UNI;

        //approve for add liquidity and swap. 2**256-1 never used up.
        IERC20(_token).safeApprove(UNISWAP_V2_ROUTER, 2**256-1);
        IERC20(_token).safeApprove(CURVE_FI, 2**256-1);

        token = _token;
        controller = _controller;

        curve_tokenID[dai] = int128(0);	//DAI
        curve_tokenID[usdc] = int128(1);	//USDC
        curve_tokenID[usdt] = int128(2);	//USDT
    }

    function deposit(uint amount) public nonReentrant returns(uint share) {
        require(amount > 0, 'Are you kidding me?');
        // 以下两行代码的顺序非常重要：必须先缓存总资产，然后再转账. 否则计算会出错.
        uint _total_assets = totalAssets();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        if(totalSupply == 0){
            share = amount;
        }
        else{
            share = amount.mul(totalSupply).div(_total_assets);
            // user uni debt
            uint debt = share.mul(totalDebts.add(totalUNIRewards())).div(totalSupply);
            if(debt > 0){
                debtOf[msg.sender] = debtOf[msg.sender].add(debt);
                totalDebts = totalDebts.add(debt);
            }
        }

        investmentOf[msg.sender] = investmentOf[msg.sender].add(amount);
        totalInvestment = totalInvestment.add(amount);
        _mint(msg.sender, share);
        emit Deposit(msg.sender, amount, share);
    }

    /**
    * @notice 按照基金设定比例投资流动池，统一操作可以节省用户gas消耗.
    * 当合约中还未投入流动池的资金额度较大时，一次性投入会产生较大滑点，可能要分批操作，所以投资行为必须由基金统一操作.
     */
    function invest(uint amount) external onlyController {
        uint len = pairs.length;
        require(len>0, 'Pairs is empty.');
        address token0 = token;
        require(amount <= IERC20(token0).balanceOf(address(this)), "Not enough balance.");

        for(uint i=0; i<len; i++){
            address token1 = pairs[i].token;
            uint amount0 = (amount.mul(pairs[i].proportion).div(DIVISOR)) >> 1;
            uint amount1;
            if( paths[token0][token1] == SwapPath.CURVE )
                amount1 = _swapByCurve(token0, token1, amount0);
            else
                amount1 = _swap(token0, token1, amount0);

            (,uint amountB,) = IUniswapV2Router(UNISWAP_V2_ROUTER).addLiquidity(
                token0, token1,
                amount0, amount1,
                0, 0,
                address(this), block.timestamp
            );
            /**
            一般而言，由于存在交易滑点和手续费，交易所得token1的数量会少于流动池中(token0:token1)比率
            所需的token1数量. 所以，token1会全部加入流动池，而基金本币(token0)会剩余一点.
            但依然存在特殊情况: 当交易路径是curve，同时curve中的价格比uniswap上的交易价格低，那么得到
            的token1数量就有可能超过流动池中(token0:token1)比率所需的token1数量.
            如果出现这种特殊情况，token1会剩余，需要将多余的token1换回token0.
            */
            if(amount1 > amountB) {
                if( paths[token1][token0] == SwapPath.CURVE )
                    _swapByCurve(token1, token0, amount1.sub(amountB));
                else
                    _swap(token1, token0, amount1.sub(amountB));
            }
        }
    }

    function setUNIPool(address pair, address _uniPool) external onlyController {
        require(pair!= address(0) && _uniPool!= address(0), "Invalid args address.");
        if(uniPool[pair] != address(0)){
            _withdrawStaking(IUniswapV2Pair(pair), totalSupply);
        }
        IERC20(pair).approve(_uniPool, 2**256-1);
        uniPool[pair] = _uniPool;
    }

    function mineUNI(address pair) public onlyController {
        address stakingRewardAddr = uniPool[pair];
        if(stakingRewardAddr != address(0)){
            uint liquidity = IUniswapV2Pair(pair).balanceOf(address(this));
            if(liquidity > 0){
                IStakingRewards(stakingRewardAddr).stake(liquidity);
            }
        }
    }

    function mineUNIAll() external onlyController {
        for(uint i = 0; i < pairs.length; i++){
            IUniswapV2Pair pair = IUniswapV2Pair(IUniswapV2Factory(UNISWAP_FACTORY).getPair(token, pairs[i].token));
            address stakingRewardAddr = uniPool[address(pair)];
            if(stakingRewardAddr != address(0)){
                uint liquidity = pair.balanceOf(address(this));
                if(liquidity > 0){
                    IStakingRewards(stakingRewardAddr).stake(liquidity);
                }
            }
        }
    }

    function totalUNIRewards() public view returns(uint amount){
        amount = IERC20(UNI).balanceOf(address(this));
        for(uint i = 0; i < pairs.length; i++){
            IUniswapV2Pair pair = IUniswapV2Pair(IUniswapV2Factory(UNISWAP_FACTORY).getPair(token, pairs[i].token));
            address stakingRewardAddr = uniPool[address(pair)];
            if(stakingRewardAddr != address(0)){
                amount = amount.add(IStakingRewards(stakingRewardAddr).earned(address(this)));
            }
        }
    }

    function UNIRewardsOf(address account) public view returns(uint reward){
        if(balanceOf[account] > 0){
            uint uniAmount = totalUNIRewards();
            uint totalAmount = totalDebts.add(uniAmount).mul(balanceOf[account]).div(totalSupply);
            reward = totalAmount.sub(debtOf[account]);
        }
    }

    function stakingLPOf(address pair) public view returns(uint liquidity){
        if(uniPool[pair] != address(0)){
            liquidity = IStakingRewards(uniPool[pair]).balanceOf(address(this));
        }
    }

    function _withdrawStaking(IUniswapV2Pair pair, uint share) internal returns(uint liquidity){
        address stakingRewardAddr = uniPool[address(pair)];
        if(stakingRewardAddr != address(0)){
            liquidity = IStakingRewards(stakingRewardAddr).balanceOf(address(this)).mul(share).div(totalSupply);
            if(liquidity > 0){
                IStakingRewards(stakingRewardAddr).withdraw(liquidity);
                IStakingRewards(stakingRewardAddr).getReward();
            }
        }
    }

    function withdraw(uint share) public nonReentrant returns(uint amount) {
        require(share > 0 && share <= balanceOf[msg.sender], 'Not enough balance.');

        uint _investment;
        (amount, _investment) = _withdraw(msg.sender, share);
        investmentOf[msg.sender] = investmentOf[msg.sender].sub(_investment);
        totalInvestment = totalInvestment.sub(_investment);
        _burn(msg.sender, share);
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount, share);
    }

    function _withdraw(
        address user,
        uint share
    ) internal returns (uint amount, uint investment) {
        address token0 = token;
        amount = IERC20(token0).balanceOf(address(this)).mul(share).div(totalSupply);
        for(uint i = 0; i < pairs.length; i++) {
            address token1 = pairs[i].token;
            IUniswapV2Pair pair = IUniswapV2Pair(IUniswapV2Factory(UNISWAP_FACTORY).getPair(token0, token1));
            uint liquidity = pair.balanceOf(address(this)).mul(share).div(totalSupply);
            liquidity  = liquidity.add(_withdrawStaking(pair, share));

            if(liquidity > 0){
                (uint amount0, uint amount1) = IUniswapV2Router(UNISWAP_V2_ROUTER).removeLiquidity(
                    token0, token1,
                    liquidity,
                    0, 0,
                    address(this), block.timestamp
                );
                amount = amount.add(amount0);
                if( paths[token1][token0] == SwapPath.CURVE )
                    amount = amount.add(_swapByCurve(token1, token0, amount1));
                else
                    amount = amount.add(_swap(token1, token0, amount1));
            }
        }

        //withdraw UNI reward
        uint uniAmount = IERC20(UNI).balanceOf(address(this));
        uint totalAmount = totalDebts.add(uniAmount).mul(share).div(totalSupply);
        if(totalAmount > 0){
            uint debt = debtOf[user].mul(share).div(balanceOf[user]);
            debtOf[user] = debtOf[user].sub(debt);
            totalDebts = totalDebts.sub(debt);
            uint reward = totalAmount.sub(debt);
            if(reward > uniAmount) reward = uniAmount;
            if(reward > 0) IERC20(UNI).transfer(user, reward);
        }

        //用户赚钱才是关键!
        investment = investmentOf[user].mul(share).div(balanceOf[user]);
        if(amount > investment){
            uint _fee = (amount.sub(investment)).mul(FEE).div(DIVISOR);
            amount = amount.sub(_fee);
            IERC20(token0).safeTransfer(controller, _fee);
        }
        else {
            investment = amount;
        }
    }

    function assets(uint index) public view returns(uint _assets) {
        require(index < pairs.length, 'Pools index out of range.');
        address token0 = token;
        address token1 = pairs[index].token;
        IUniswapV2Pair pair = IUniswapV2Pair(IUniswapV2Factory(UNISWAP_FACTORY).getPair(token0, token1));
        (uint reserve0, uint reserve1, ) = pair.getReserves();

        uint liquidity = pair.balanceOf(address(this)).add(stakingLPOf(address(pair)));
        if( pair.token0() == token0 )
            _assets = (reserve0 << 1).mul(liquidity).div(pair.totalSupply());
        else // pair.token1() == token0
            _assets = (reserve1 << 1).mul(liquidity).div(pair.totalSupply());
    }

    function totalAssets() public view returns(uint _assets) {
        address token0 = token;
        for(uint i=0; i<pairs.length; i++){
            address token1 = pairs[i].token;
            IUniswapV2Pair pair = IUniswapV2Pair(IUniswapV2Factory(UNISWAP_FACTORY).getPair(token0, token1));
            (uint reserve0, uint reserve1, ) = pair.getReserves();
            uint liquidity = pair.balanceOf(address(this)).add(stakingLPOf(address(pair)));
            if( pair.token0() == token0 )
                _assets = _assets.add((reserve0 << 1).mul(liquidity).div(pair.totalSupply()));
            else // pair.token1() == token0
                _assets = _assets.add((reserve1 << 1).mul(liquidity).div(pair.totalSupply()));
        }
        _assets = _assets.add(IERC20(token0).balanceOf(address(this)));
    }

    function pairsLength() public view returns(uint) {
        return pairs.length;
    }

    function setSwapPath(
        address tokenIn,
        address tokenOut,
        SwapPath path
    ) external onlyController {
        paths[tokenIn][tokenOut] = path;
    }

    /**
    * @notice 添加流动池时，已有的流动池等比缩减.
    * 注意：等比缩减可能出现浮点数，而solidity对浮点数只能取整，从而造成合计比例不足100，添加会失败.
    * 所以需要精心选择添加比例, 如果无法凑整，则需要先调用adjustPair调整比例.
    * 添加流动池后，只影响后续投资，没有调整已有的投资。如果要调整已投入的流动池，应该用reBalance函数.
    */
    /**
    * @notice 添加流动池时，已有的流动池等比缩减.
    * 注意：等比缩减可能出现浮点数，而solidity对浮点数只能取整，从而造成合计比例不足100，添加会失败.
    * 所以需要精心选择添加比例, 如果无法凑整，则需要先调用adjustPair调整比例.
    * 添加流动池后，只影响后续投资，没有调整已有的投资。如果要调整已投入的流动池，应该用reBalance函数.
    */
    function addPair(address _token, uint[] calldata proportions) external onlyController {
        uint _whole;
        uint addIndex = pairs.length;
        address pair = IUniswapV2Factory(UNISWAP_FACTORY).getPair(token, _token);
        require(pair != address(0), 'Pair not exist.');
        require(proportions.length == addIndex+1, 'Pairs index out of range.');

        //approve for add liquidity and swap.
        IERC20(_token).safeApprove(UNISWAP_V2_ROUTER, 2**256-1);
        IERC20(_token).safeApprove(CURVE_FI, 2**256-1);
        //approve for remove liquidity
        IUniswapV2Pair(pair).approve(UNISWAP_V2_ROUTER, 2**256-1);

        pairs.length++;
        pairs[addIndex].token = _token;
        for(uint i = 0; i <= addIndex; i++) {
            if(i < addIndex) require(pairs[i].token != _token, 'Add pair repeatedly.');
            pairs[i].proportion = proportions[i];
            _whole = _whole.add(proportions[i]);
        }
        require(_whole == DIVISOR, 'Error proportion.');
    }

    /**
    * @notice 调整流动池.
    * 每次只能调整2个流动池的流动性，一个升，一个降.
    * 如果要移除某个流动池，将该流动池的流动性降到0即可. 对于移除的流动池，需要将该流动池清空.
    * 调整之后只影响后续投资，没有调整已有的投资。如果要调整已投入的流动池，应该用reBalance函数.
    */
    function adjustPairs(uint[] calldata proportions) external onlyController {
        uint _whole;
        require(proportions.length == pairs.length, 'Pairs index out of range.');

        for(uint i=0; i<pairs.length; i++) {
            pairs[i].proportion = proportions[i];
            _whole = _whole.add(proportions[i]);
        }
        require(_whole == DIVISOR, 'Error proportion.');
    }

    /**
    * @notice 调整已投入的流动池.
    * 在调整流动池时, 如果金额较大，则应该考虑分次调整, 多付几笔gas费用，尽量降低滑点.
     */
    function reBalance(
        uint add_index,
        uint remove_index,
        uint liquidity
    ) external onlyController {
        require(
            add_index < pairs.length &&
            remove_index < pairs.length &&
            add_index != remove_index, 'Pairs index out of range.'
        );

        //撤出&兑换
        address token0 = token;
        address token1 = pairs[remove_index].token;
        IUniswapV2Pair pair = IUniswapV2Pair(IUniswapV2Factory(UNISWAP_FACTORY).getPair(token0, token1));

        uint stakingLP = stakingLPOf(address(pair));
        if(stakingLP > 0) IStakingRewards(uniPool[address(pair)]).exit();

        require(liquidity <= pair.balanceOf(address(this)), 'Not enough liquidity.');

        (uint amount0, uint amount1) = IUniswapV2Router(UNISWAP_V2_ROUTER).removeLiquidity(
            token0, token1,
            liquidity,
            0, 0,
            address(this), block.timestamp
        );
        if( paths[token1][token0] == SwapPath.CURVE )
            amount0 = amount0.add(_swapByCurve(token1, token0, amount1));
        else
            amount0 = amount0.add(_swap(token1, token0, amount1));

        //兑换&投入
        token1 = pairs[add_index].token;
        amount0 = amount0 >> 1;
        if( paths[token0][token1] == SwapPath.CURVE )
            amount1 = _swapByCurve(token0, token1, amount0);
        else
            amount1 = _swap(token0, token1, amount0);

        (,uint amountB,) = IUniswapV2Router(UNISWAP_V2_ROUTER).addLiquidity(
            token0, token1,
            amount0, amount1,
            0, 0,
            address(this), block.timestamp
        );

        //处理dust. 如果有的话
        if(amount1 > amountB) {
            if( paths[token1][token0] == SwapPath.CURVE )
                _swapByCurve(token1, token0, amount1.sub(amountB));
            else
                _swap(token1, token0, amount1.sub(amountB));
        }
    }

    function removePair(uint index) external onlyController {
        require(index < pairs.length, 'Pairs index out of range.');
        require(pairs[index].proportion == 0, 'Proportion is not equal to 0.');

        //撤出&兑换
        address token0 = token;
        address token1 = pairs[index].token;
        IUniswapV2Pair pair = IUniswapV2Pair(IUniswapV2Factory(UNISWAP_FACTORY).getPair(token0, token1));
        _withdrawStaking(pair, totalSupply);
        uint liquidity = pair.balanceOf(address(this));

        if(liquidity > 0){
            (uint amount0, uint amount1) = IUniswapV2Router(UNISWAP_V2_ROUTER).removeLiquidity(
                token0, token1,
                liquidity,
                0, 0,
                address(this), block.timestamp
            );
            if( paths[token1][token0] == SwapPath.CURVE )
                amount0 = amount0.add(_swapByCurve(token1, token0, amount1));
            else
                amount0 = amount0.add(_swap(token1, token0, amount1));
        }
        IERC20(token1).safeApprove(UNISWAP_V2_ROUTER, 0);
        IERC20(token1).safeApprove(CURVE_FI, 0);

        for (uint i = index; i<pairs.length-1; i++){
            pairs[i] = pairs[i+1];
        }
        pairs.pop();
    }

    function _swap(address tokenIn, address tokenOut, uint amount) private returns(uint) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint[] memory amounts = IUniswapV2Router(UNISWAP_V2_ROUTER).swapExactTokensForTokens(
            amount,
            0,
            path,
            address(this), block.timestamp);
        return amounts[1];
    }

    function _swapByCurve(address tokenIn, address tokenOut, uint amount) private returns(uint) {
        int128 id0 = curve_tokenID[tokenIn];
        int128 id1 = curve_tokenID[tokenOut];
        ICurve(CURVE_FI).exchange(id0, id1, amount, 0);
        return IERC20(tokenOut).balanceOf(address(this));
    }
}
