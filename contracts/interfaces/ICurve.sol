pragma solidity >=0.5.0;

interface ICurve {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external;
    function coins(uint256) external view returns (address coin);
}