var trader = require('./trader');
var xCoin = require('../lib/xCoin');
var common;



module.exports = {
  init : function(event){
    common = event;
    xCoin.init();
    trader.init(common);
  }
}
