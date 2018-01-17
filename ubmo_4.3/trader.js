var macd = require('macd');
var fs = require('fs');
var log = require('../../logger');
var events = require('events');
var eventEmitter = new events.EventEmitter();

var currencyInfo = {};

const PERIODS = {
  long: 26 * 15,
  short: 12 * 15,
  signal: 9 * 15
};
const intervalTime = 5000;
var stack = 0;
var tradeAmount = 0;
var tickCount = 0;
var myCapInfo = {};
var myWallet;
var currArr;
var tradeInterval;
var defaultAlpha = 0;
var currentAlpha = 0;
var previousAlpha = 0;
var isAlpha = false;

function Currency(key, name, cap) {
  this.name = name;
  this.key = key;
  this.price = [];
  this.histogram = [];
  this.maxMacd = 0;
  this.initTrade = false;
  this.tradeStack = 0;
  this.buyPrice = 0;
  this.sellPrice = 0;
  this.recentTradePrice = 0;
  this.startDate = 0;
  this.cap = cap;
  this.boughtPrice = 0;
}

function Wallet(defaultMoney) {
  this.default = defaultMoney;
  this.total = 0;
  this.krw = defaultMoney;
  this.totalTradeAmount = 0;
}

function makeWallet(obj, cb) {
  fs.readFile('../../logs/alphaCap.json', function(err, capData){
    myCapInfo = JSON.parse(decodeURIComponent(capData));
                                                                                                    
    fs.readFile('../../currency.json', function(err, data) {
      var currObj = JSON.parse(decodeURIComponent(data))[0];
      currArr = Object.keys(currObj);
  
      for (var i = 0; i < currArr.length; i++) {
        obj[currArr[i]] = 0;
        var key = currArr[i];
        var cap = myCapInfo[key].cap;
        currencyInfo[key] = new Currency(key, currObj[key], cap);
      }

      cb();
      
    });
  })
}

function checkTicker(currency) {
  var key = currency.key;
  var name = currency.name;
  var curPrice;
  var _histogram;

  fs.readFile('../../logs/' + key + '.txt', 'utf8', function(err, body){
    try {
      var result = JSON.parse(body); 
      var price = currencyInfo[key].price = result.price.slice(0);
      var sellPrice = currencyInfo[key].sellPrice = result.sellPrice;
      var buyPrice = currencyInfo[key].buyPrice = result.buyPrice;

      curPrice = price.slice(-1)[0];

      /**
       * @param data Array.<Number> the collection of prices
       * @param slowPeriods Number=26 the size of slow periods. Defaults to 26
       * @param fastPeriods Number=12 the size of fast periods. Defaults to 12
       * @param signalPeriods Number=9 the size of periods to calculate the MACD signal line.
       * 
       * @return MACD, signal, histogram
       */
      var graph = macd(price, PERIODS.long, PERIODS.short, PERIODS.signal);
      currency.histogram = _histogram = graph.histogram.slice(0);

      var curHisto = _histogram.slice(-1)[0];
      var prevHisto = _histogram.slice(-2, -1)[0];
      var readyState;

      if(currency.maxMacd < curHisto && curHisto >= 0){
        currency.maxMacd = curHisto;
      }

      if(curHisto < 0){
        currency.maxMacd = 0;
      }
      
      if (stack < 10){
        sellCoin(currency, sellPrice);
      } else {
        if (_histogram.length > PERIODS.long) {
          if(curHisto > 0){
            if(currency.maxMacd * 0.8 > curHisto){
              sellCoin(currency, sellPrice);
            } else if(myWallet.krw >= 1000 && (curHisto * prevHisto < -1 || curHisto == currency.maxMacd) && currency.tradeStack <= 0 && curHisto > 10 && isAlpha && currency.boughtPrice < curPrice) {
              buyCoin(currency, buyPrice, curPrice);
            } else if(myWallet.krw >= 1000 && !currency.initTrade && curHisto > 10 && isAlpha && currency.boughtPrice < curPrice){
              currency.initTrade = true;
              buyCoin(currency, buyPrice, curPrice);
            }
          } else {
            sellCoin(currency, sellPrice);
          }
        }
      }

      myWallet.total +=  myWallet * curPrice;
      currentAlpha += currency.cap * curPrice; 

      if(curHisto > 0 && myWallet[key] > 0){
        console.log(`${key}: ${curHisto.toFixed(2)}/${currency.maxMacd.toFixed(2)}(${Math.floor(curHisto/currency.maxMacd*100).toFixed(2)}) tradeStack : ${currency.tradeStack}`);
      }

      tickCount++;
      if(currency.tradeStack > 0) currency.tradeStack--;
      eventEmitter.emit('collected');
    } catch (e) {
      
     console.log(e);
      myWallet.total += myWallet[key] * currencyInfo[key].price.slice(-1)[0];
      tickCount++;
      console.log('restart server........')
      eventEmitter.emit('collected');
    }
  });
}

function buyCoin(currency, price, curPrice) {
  var name = currency.name;
  var key = currency.key;
  var krw = myWallet.krw;
  var buyCount = krw / 4 / price;
  var logMessage;

  if (buyCount > 0.0001) {
    tradeAmount += krw * 0.25;
    myWallet.totalTradeAmount += krw * 0.25;
    myWallet.krw = krw * 0.75;
    myWallet[key] += buyCount;
    currency.tradeStack = 5;
    currency.maxMacd = 0;
    currency.boughtPrice = curPrice;

    // for log
    logMessage = '[' + name + ']  buy ' + buyCount + '(' + currency.histogram.slice(-1)[0].toFixed(2) + ') -' + price;
    console.log(logMessage);
    log.write('log', logMessage + '\n', true);
  }
}

function sellCoin(currency, price) {
  var name = currency.name;
  var key = currency.key;

  if (myWallet[key] >= 0.0001) {
    tradeAmount += myWallet[key] * price;
    myWallet.totalTradeAmount += myWallet[key] * price;
    myWallet.krw += myWallet[key] * price;
    myWallet[key] = 0;
    currency.tradeStack = 5;
    currency.maxMacd = 0;


    // for log
    logMessage = '[' + name + ']  sell ' +  myWallet[key] * price + '(' + currency.histogram.slice(-1)[0].toFixed(2) + ') - ' + price;
    console.log(logMessage);
    log.write('log', logMessage + '\n', true);
  }
}

function checkStatus(){
  var totalMoney = (myWallet.total = getTotal());
  var fee = myWallet.totalTradeAmount * 0.00075;
  var realTotal = totalMoney - fee;
  var profitRate = (realTotal / myWallet.default - 1) * 100;
  var date = new Date();
  var alphaChange = (((currentAlpha/defaultAlpha) -1) * 100).toFixed(2);
  var time = (date.getMonth() < 10 ? '0' + (date.getMonth() + 1) : (date.getMonth() + 1)) + '/' + date.getDate() + ' ' + date.getHours() + 'h ' + date.getMinutes() + 'm ' + date.getSeconds() + 's';
  var histogramCount = currencyInfo[currArr[0]].histogram.length;
  var readyState = histogramCount > PERIODS.long ? 'ok' : 'ready';
  var logMessage;

  if(stack <= 1){
    myWallet.startDate = date.getDate();
    defaultAlpha = previousAlpha = currentAlpha;
  }

  if(myWallet.startDate < date.getDate()){
    myWallet.default = totalMoney;
    myWallet.startDate = date.getDate();
    defaultAlpha = previousAlpha = currentAlpha;
    tradeAmount = 0;
  }

  if(currentAlpha >= 0){
    isAlpha = !!(currentAlpha >= previousAlpha);
  } else {
    isAlpha = !!(currentAlpha > previousAlpha);

  previousAlpha = Number(currentAlpha);
  }
  currentAlpha = 0;

  logMessage = '[' + stack + '][' + histogramCount + '][' + readyState + '] Total Money: ' + Math.floor(realTotal) + '(' + profitRate.toFixed(2) +
  '%)  market: ' + alphaChange + '%('+ (isAlpha ? '+' : '-') +')   tradeAmount : ' + Math.floor(tradeAmount) + '('+ Math.floor(myWallet.totalTradeAmount) + ')  fee: ' +  Math.floor(fee) + '  curKRW: ' + Math.floor(myWallet.krw) + ' || ' + time;

  if (stack % 10 == 0) {
    var walletStatus = '\n////////My Wallet Status ///////// \n';
    for (var i in myWallet) {
      if (i == 'default' || i == 'total') {
        walletStatus += '[' + i + '] : ' + myWallet[i] + '\n';
      } else if(myWallet[i] > 0){
        walletStatus += '[' + i + '] : ' + myWallet[i] + '\n';
      }
    }
    log.write('profitLog', walletStatus + '\b', true);
    fs.writeFile('./logs/wallet.txt', JSON.stringify(myWallet), function(){
      console.log(walletStatus);
    })  
  }

  if(stack > 0) console.log(logMessage);

  log.write('log', logMessage + '\n', true);
  stack++;

  if(totalMoney < myWallet.default * 0.8 && stack > 1){
    console.log('The end, Go to the hanriver!!!');
    return false;
  }


  for (var i = 0; i < currArr.length; i++){
    checkTicker(currencyInfo[currArr[i]]);
  }
}

function getTotal() {
  var total = 0;
  for (var key in myWallet) {
    if (key !== 'default' && key !== 'total' && key !== 'krw' && key !== 'startDate' && key !== 'totalTradeAmount') {
      var curPrice = myWallet[key] * currencyInfo[key].price.slice(-1)[0];
      total += isNaN(curPrice) ? 0 : curPrice;
    } else if(key === 'krw') {
      total += myWallet[key];
    }
  }

  return total;
}

function readData(){
  var i = 0;

  try {
      myWallet = JSON.parse(log.read('wallet.txt'));
      console.log('read my wallet');
      console.log('Data load Complete');
      checkStatus();
    
  } catch(e) {
    console.log('there is no wallet file');
    console.log('Data load Complete');
    checkStatus();
  }

  
}

eventEmitter.on('collected', function() {
  if (tickCount == currArr.length) {
    tickCount = 0;
    setTimeout(function(){
      checkStatus()
    }, intervalTime);
  }
});

eventEmitter.on('inited', function() {
  console.log('inited');
  readData();
});

module.exports = {
  init: function(defaultMoney) {
    myWallet = new Wallet(defaultMoney);
    makeWallet(myWallet, function() {
      console.log(myWallet);
      eventEmitter.emit('inited');
    });
  }
};
