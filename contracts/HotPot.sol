pragma solidity >=0.5.0;

import './libraries/SafeMath.sol';

contract HotPot {
    using SafeMath for uint;

    string public constant name = 'Hotpot Funds';
    string public constant symbol = 'HPT';
    uint8 public constant decimals = 18;
    uint public totalSupply = 1000000e18;  // Initial supply 1 million HotPot.

    mapping(address => uint) public balanceOf;

    mapping(address => mapping(address => uint)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    constructor(address account) public {
        balanceOf[account] = totalSupply;
        emit Transfer(address(0), account, totalSupply);
    }

    function _burn(address from, uint value) internal {
        require(from != address(0), "ERC20: burn from the zero address");

        balanceOf[from] = balanceOf[from].sub(value);
        totalSupply = totalSupply.sub(value);
        emit Transfer(from, address(0), value);
    }

    function _approve(address owner, address spender, uint value) private {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _transfer(address from, address to, uint value) private {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        balanceOf[from] = balanceOf[from].sub(value);
        balanceOf[to] = balanceOf[to].add(value);
        emit Transfer(from, to, value);
    }

    function approve(address spender, uint value) external returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint value) external returns (bool) {
        allowance[from][msg.sender] = allowance[from][msg.sender].sub(value);
        _transfer(from, to, value);
        return true;
    }

    function burn(uint value) external returns (bool) {
        _burn(msg.sender, value);
        return true;
    }

    function burnFrom(address from, uint value) external returns (bool) {
        allowance[from][msg.sender] = allowance[from][msg.sender].sub(value);
        _burn(msg.sender, value);
        return true;
    }
}
