const hotpot = artifacts.require("HotPot");

module.exports = function(deployer) {
  deployer.deploy(hotpot);
};
