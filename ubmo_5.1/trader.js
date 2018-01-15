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
var myWallet;
var currArr;
var tradeInterval;

function Currency(key, name) {
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
  this.isTradable = false;
  this.trendLine = {
    isTrend: false,
    default : {
      price : 0,
      stack : 0
    },
    min : {
      price : 0,
      stack : 0
    },
    max : {
      price : 0,
      stack : 0
    },
    slope: 0
  }
}

function Wallet(defaultMoney) {
  this.default = defaultMoney;
  this.total = 0;
  this.krw = defaultMoney;
}

function makeWallet(obj, cb) {
  fs.readFile('../../currency.json', function(err, data) {
    var currObj = JSON.parse(decodeURIComponent(data))[0];
    currArr = Object.keys(currObj);

    for (var i = 0; i < currArr.length; i++) {
      obj[currArr[i]] = 0;
      currencyInfo[currArr[i]] = new Currency(currArr[i], currObj[currArr[i]]);
    }

    cb();
  });
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
      var sellPrice = currencyInfo[key].sellPrice = result.sellPrice.slice(0);
      var buyPrice = currencyInfo[key].buyPrice = result.buyPrice.slice(0);
      var trendLine = currencyInfo[key].trendLine;
      var isTradable = currencyInfo[key].isTradable;

      curPrice = price.slice(-1);
      prevPrice = price.slice(-2, -1);
      curSellPrice = sellPrice.slice(-1);
      curBuyPrice = buyPrice.slice(-1);

      /**
       * @description TrendLine 
       * @param price currency price
       * @param maxPrice max currency price until breaking the trendline
       * @param minPrice min currency price until breaking the trendline
       */

      if(stack == 1){
        trendLine.default.price = trendLine.max.price = trendLine.min.price = curPrice;
        trendLine.default.stack = trendLine.max.stack = trendLine.min.stack = stack;
      }

      if(curPrice > 0 && stack > 1){
        trendLine.price = curPrice;

        if(curPrice > trendLine.maxPrice){
          trendLine.isTrend = true;
          trendLine.max.price = curPrice;
          trendLine.max.stack = stack;
        } else {
          trendLine.isTrend = false;
          trendLine.min.stack = stack;
          trendLine.min.price = curPrice;
        }

        if(!trendLine.isTrend && curPrice > prevPrice){
          trendLine.min.stack = stack;
          trendLine.min.price = curPrice;
        }

        var prevSlope = trendLine.slope;
        var curSlope = (trendLine.min.price - trendLine.default.price) / (trendLine.min.stack - trendLine.default.stack);
        var diff = (curSlope - prevSlope).toFixed(2);
        diff = isNaN(diff) ? 0 : diff;
        if(curSlope < prevSlope){
          // 매도
          isTradable = false;
        } else {
          // 매수 or 갖고 있음
          isTradable = true;
        }
        trendLine.slope = (trendLine.min.price - trendLine.default.price) / (trendLine.min.stack - trendLine.default.stack);
      }

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
      var prevHisto = _histogram.slice(-2, -1);
      var readyState;

      if(currency.maxMacd < curHisto && curHisto >= 0){
        currency.maxMacd = curHisto;
      }

      if(curHisto < 0){
        currency.maxMacd = 0;
      }
      
      if (stack < 5){
        sellCoin(currency, curSellPrice);
      } else {
        if (_histogram.length > PERIODS.long) {
          if(curHisto > 0){
            if(!isTradable && currency.tradeStack <= 0){
            //if(currency.maxMacd * 0.8 > curHisto){
              sellCoin(currency, curSellPrice);
            } else if(myWallet.krw >= 1000 && (curHisto * prevHisto < -1 || curHisto == currency.maxMacd) && currency.tradeStack <= 0 && curHisto > 10) {
              buyCoin(currency, curBuyPrice);
            } else if(myWallet.krw >= 1000 && !currency.initTrade && curHisto > 10){
              currency.initTrade = true;
              buyCoin(currency, curBuyPrice);
            }
          } else {
            sellCoin(currency, curSellPrice);
          }
        }
      }

      myWallet.total += myWallet[key] * curPrice;

      if(isTradable){
        console.log(`${key}: ${curHisto.toFixed(2)}/${currency.maxMacd.toFixed(2)}(${Math.floor(curHisto/currency.maxMacd*100).toFixed(2)}) tradeStack : ${currency.tradeStack} slope : ${stack == 1 ? 'init' : diff} tradable: ${isTradable}`);
      }

      tickCount++;
      if(currency.tradeStack > 0) currency.tradeStack--;
      eventEmitter.emit('collected');
      // fs.writeFile('./logs/' +  key + '.txt', JSON.stringify({price: price}), 'utf8', (err) => {
      //   if(err) console.log(err)
      // });
    } catch (e) {
      console.log(e);
      tickCount++;
      console.log('restart server........')
      eventEmitter.emit('collected');
    }
  });
}

function buyCoin(currency, price) {
  var name = currency.name;
  var key = currency.key;
  var krw = myWallet.krw;
  var buyCount = krw / 2 / price;
  var logMessage;

  if (buyCount > 0.0001) {
    tradeAmount += krw * 0.5;
    myWallet.krw = krw * 0.5;
    myWallet[key] += buyCount;
    currency.tradeStack = 5;
    currency.maxMacd = 0;

    // for log
    logMessage = '[' + name + ']  buy ' + buyCount + '(' + currency.histogram.slice(-1)[0].toFixed(2) + ') -' + price;
    console.log(logMessage);
    log.write('log', '\n' + logMessage + '\n', true);
  }
}

function sellCoin(currency, price) {
  var name = currency.name;
  var key = currency.key;

  if (myWallet[key] >= 0.0001) {
    tradeAmount += myWallet[key] * price;
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
  var profitRate = (totalMoney / myWallet.default - 1) * 100;
  var date = new Date();
  var histogramCount = currencyInfo[currArr[0]].histogram.length;
  var readyState = histogramCount > PERIODS.long ? 'ok' : 'ready';
  var logMessage = '[' + stack + '][' + histogramCount + '][' + readyState + '] Total Money: ' + totalMoney.toFixed(2) + '/(' + profitRate.toFixed(2) +
    '%)  tradeAmount: ' + Math.floor(tradeAmount) + '   curKRW: ' + Math.floor(myWallet.krw) + ' || ' + date;

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

  if(stack > 0) console.log('\n' + logMessage);

  log.write('log', logMessage + '\n', true);
  stack++;

  if(totalMoney  < myWallet.default * 0.8 && stack > 1){
    console.log('the end');
    return false;
  }

  for (var i = 0; i < currArr.length; i++){
    checkTicker(currencyInfo[currArr[i]]);
  }
}

function getTotal() {
  var total = 0;
  for (var key in myWallet) {
    if (key !== 'default' && key !== 'total' && key !== 'krw') {
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

  // for(var key in currencyInfo){
  //   var filename = currencyInfo[key].key + '.txt';
  //   i++;
  //   try {
  //     currencyInfo[key].price = JSON.parse(log.read(filename)).price.slice(0);
  //     console.log('read complete', filename, '(', i , '/', currArr.length, ')');
  //   } catch(e) {
  //     console.log(filename, 'log is not created yet.', '(', i , '/', currArr.length, ')');
  //   }
  // }

  try {
    myWallet = JSON.parse(log.read('wallet.txt'));
    console.log('read my wallet');
  } catch(e) {
    console.log('there is no wallet file');
  }

  console.log('Data load Complete');
  checkStatus();
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
