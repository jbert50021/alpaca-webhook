//@version=5
indicator("RSI + VWAP Alert (Debugged for Entry Precision)", overlay=true)

// === Inputs ===
debugMode = input.bool(true, title="Show Debug Info")
minVolume = input.int(25000, title="Min Volume")
allowedTickers = input.string("IMTX,DMAC", title="Allowed Tickers (comma-separated)")

// === Ticker Filter ===
tickerList = str.split(allowedTickers, ",")
isAllowed = array.includes(tickerList, syminfo.ticker)

// === VWAP (1D) ===
vwap = request.security(syminfo.tickerid, "1D", ta.vwap)

// === RSI & Crossover Logic ===
rsi = ta.rsi(close, 14)
rsiSMA = ta.sma(rsi, 14)
rsiCross = ta.cross(rsi, rsiSMA)  // Use cross, not crossover

// === Volume Filter ===
volOkEntry = volume > minVolume

// === Day Tracking ===
daysSinceStartOfYear = math.floor((timenow - timestamp(year, 1, 1, 0, 0)) / 86400000)
var int lastSignalDay = na
currentDay = math.floor((time - timestamp(year, 1, 1, 0, 0)) / 86400000)
entrySignalToday = na(lastSignalDay) or (currentDay != lastSignalDay)

// === Entry & Exit Conditions ===
entrySignal = isAllowed and rsi < 70 and rsi > 50 and rsiCross and volOkEntry and entrySignalToday
exitSignal = isAllowed and rsi > 65 and rsiCross and volOkEntry

// === Record entry signal day ===
if entrySignal
    lastSignalDay := currentDay

// === Debug Labels ===
if debugMode and entrySignal
    label.new(x=bar_index, y=high, text="BUY\nRSI: " + str.tostring(rsi, '#.##') + "\nVWAP: " + str.tostring(vwap, '#.##'), style=label.style_label_up, color=color.green, textcolor=color.white, size=size.small, yloc=yloc.abovebar)
if debugMode and exitSignal
    label.new(x=bar_index, y=low, text="SELL\nRSI: " + str.tostring(rsi, '#.##') + "\nVWAP: " + str.tostring(vwap, '#.##'), style=label.style_label_down, color=color.red, textcolor=color.white, size=size.small, yloc=yloc.belowbar)

// === Alerts ===
alertcondition(entrySignal, title="Buy Alert", message="BUY: RSI rising and crossing SMA with volume")
alertcondition(exitSignal, title="Sell Alert", message="SELL: RSI high and curling down")
