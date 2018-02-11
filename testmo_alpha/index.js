var trader = require('./trader');


module.exports = {
  init : function(event){
    trader.init(event, 2000000);

  }
}
