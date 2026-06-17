var BASE_TEMP = 10.0;   // 基準温度
var TARGET    = 800.0;  // 収穫目標（℃・日）
var MAX_KABUSA = 10;    // ★管理したい最大花房数（10房）

// =================================================================
// 1. センサー端末やWebからのデータ受信（自動実行）
// =================================================================
function doGet(e) {
  try {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = spreadsheet.getSheetByName("データー");
    if (sheet == null) sheet = spreadsheet.insertSheet("データー");
    
    var temp = e.parameter.temperature ? parseFloat(e.parameter.temperature) : 0;
    var hum  = e.parameter.humidity ? parseFloat(e.parameter.humidity) : 0;
    
    var now = new Date();
    var timestamp = Utilities.formatDate(now, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
    var todayStr  = Utilities.formatDate(now, "Asia/Tokyo", "yyyy/MM/dd");

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["日付", "時刻", "温度(℃)", "湿度(%)"]);
    }
    
    sheet.insertRowAfter(1);
    sheet.getRange(2, 1, 1, 4).setValues([[todayStr, timestamp, temp, hum]]);
    
    updateSummary(spreadsheet, todayStr);
    updateKabusa(spreadsheet, todayStr);
    
    return ContentService.createTextOutput(
      JSON.stringify({"status": "success"})
    ).setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService.createTextOutput(
      JSON.stringify({"status": "error", "message": err.toString()})
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// =================================================================
// 2. 日ごとの気温集計と累計積算温度の計算
// =================================================================
function updateSummary(spreadsheet, todayStr) {
  if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!todayStr || typeof todayStr !== 'string') {
    todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");
  }

  var summary = spreadsheet.getSheetByName("サマリー");
  
  if (summary == null) {
    summary = spreadsheet.insertSheet("サマリー");
    summary.appendRow(["日付", "最高気温(℃)", "最低気温(℃)", "平均気温(℃)", "有効積算温度(℃・日)", "累計積算温度(℃・日)"]);
  } else {
    summary.getRange(1, 1, 1, 6).setValues([["日付", "最高気温(℃)", "最低気温(℃)", "平均気温(℃)", "有効積算温度(℃・日)", "累計積算温度(℃・日)"]]);
  }

  var dataSheet = spreadsheet.getSheetByName("データー");
  var lastRow = dataSheet.getLastRow();
  if (lastRow < 2) return;
  
  var data = dataSheet.getRange(2, 1, lastRow-1, 3).getValues();

  var todayTemps = [];
  for (var i = 0; i < data.length; i++) {
    if (!data[i][0] || data[i][2] === "") continue;
    var d = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
    if (isNaN(d.getTime())) continue; 
    var rowDate = Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd");
    if (rowDate === todayStr) {
      todayTemps.push(parseFloat(data[i][2]));
    }
  }
  if (todayTemps.length === 0) return;

  var maxTemp = Math.max.apply(null, todayTemps);
  var minTemp = Math.min.apply(null, todayTemps);
  var avgTemp = todayTemps.reduce(function(a,b){return a+b;},0) / todayTemps.length;
  var effective = Math.max(0, avgTemp - BASE_TEMP);

  var summaryLastRow = summary.getLastRow();
  var summaryData = summaryLastRow >= 2 ? summary.getRange(2, 1, summaryLastRow-1, 6).getValues() : [];
  
  var foundIndex = -1;
  for (var j = 0; j < summaryData.length; j++) {
    var sDate = summaryData[j][0] instanceof Date ? summaryData[j][0] : new Date(summaryData[j][0]);
    var sDateStr = Utilities.formatDate(sDate, "Asia/Tokyo", "yyyy/MM/dd");
    if (sDateStr === todayStr) {
      foundIndex = j;
      break;
    }
  }

  var cumulative = 0;
  if (foundIndex !== -1) {
    if (foundIndex + 1 < summaryData.length) {
      cumulative = parseFloat(summaryData[foundIndex + 1][5]) || 0;
    }
  } else {
    if (summaryData.length > 0) {
      cumulative = parseFloat(summaryData[0][5]) || 0;
    }
  }
  cumulative += effective;

  var rowValues = [[
    todayStr,
    maxTemp.toFixed(1),
    minTemp.toFixed(1),
    avgTemp.toFixed(1),
    effective.toFixed(2),
    cumulative.toFixed(2)
  ]];

  if (foundIndex !== -1) {
    summary.getRange(foundIndex + 2, 1, 1, 6).setValues(rowValues);
  } else {
    summary.insertRowAfter(1);
    summary.getRange(2, 1, 1, 6).setValues(rowValues);
  }
}

// =================================================================
// 3. 各花房の開花日ベース積算温度・進捗管理
// =================================================================
function updateKabusa(spreadsheet, todayStr) {
  if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!todayStr || typeof todayStr !== 'string') {
    todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");
  }

  var kabusa = spreadsheet.getSheetByName("花房管理");
  
  if (kabusa == null) {
    kabusa = spreadsheet.insertSheet("花房管理");
    kabusa.appendRow(["花房", "開花日", "積算温度(℃・日)", "残り(℃・日)", "進捗(%)", "状態"]);
    kabusa.setColumnWidth(1, 80);
    kabusa.setColumnWidth(2, 120);
    kabusa.setColumnWidth(3, 150);
    kabusa.setColumnWidth(4, 130);
    kabusa.setColumnWidth(5, 100);
    kabusa.setColumnWidth(6, 160);
  } else {
    kabusa.getRange(1, 1, 1, 6).setValues([["花房", "開花日", "積算温度(℃・日)", "残り(℃・日)", "進捗(%)", "状態"]]);
  }

  // 強制10房チェックロジック
  for (var k = 1; k <= MAX_KABUSA; k++) {
    var cellValue = kabusa.getRange(k + 1, 1).getValue();
    if (cellValue !== "第" + k + "房") {
      kabusa.getRange(k + 1, 1, 1, 6).setValues([["第"+k+"房", "", 0, TARGET, 0, "開花日を入力してください"]]);
    }
  }

  var dataSheet = spreadsheet.getSheetByName("データー");
  var lastDataRow = dataSheet.getLastRow();
  if (lastDataRow < 2) return;
  var allData = dataSheet.getRange(2, 1, lastDataRow-1, 3).getValues();

  var lastKabusaRow = kabusa.getLastRow();
  if (lastKabusaRow < 2) return;
  
  var kabusaRange = kabusa.getRange(2, 1, lastKabusaRow-1, 6);
  var kabusaData = kabusaRange.getValues();

  for (var r = 0; r < kabusaData.length; r++) {
    var flowerDateVal = kabusaData[r][1];
    if (!flowerDateVal) continue;

    var fDate = flowerDateVal instanceof Date ? flowerDateVal : new Date(flowerDateVal);
    if (isNaN(fDate.getTime())) continue;
    var flowerDateStr = Utilities.formatDate(fDate, "Asia/Tokyo", "yyyy/MM/dd");

    var dailyTemps = {};
    for (var i = 0; i < allData.length; i++) {
      if (!allData[i][0] || allData[i][2] === "") continue;
      var d = allData[i][0] instanceof Date ? allData[i][0] : new Date(dataSheet.getRange(i+2, 1).getValue());
      if (isNaN(d.getTime())) continue;
      
      var rowDateStr = Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd");
      if (rowDateStr >= flowerDateStr) {
        if (!dailyTemps[rowDateStr]) dailyTemps[rowDateStr] = [];
        dailyTemps[rowDateStr].push(parseFloat(allData[i][2]));
      }
    }

    var accumulated = 0;
    for (var date in dailyTemps) {
      var temps = dailyTemps[date];
      var avg = temps.reduce(function(a,b){return a+b;},0) / temps.length;
      var eff = Math.max(0, avg - BASE_TEMP);
      accumulated += eff;
    }

    var progress = Math.min(100, (accumulated / TARGET * 100));
    var remaining = Math.max(0, TARGET - accumulated);
    var status = "";
    if (accumulated >= TARGET) {
      status = "✅ 収穫時期！";
    } else if (accumulated >= TARGET * 0.9) {
      status = "🍅 収穫間近！";
    } else if (accumulated >= TARGET * 0.5) {
      status = "🌿 成長中";
    } else {
      status = "🌱 生育中";
    }

    kabusaData[r][2] = accumulated.toFixed(1);
    kabusaData[r][3] = remaining.toFixed(1);
    kabusaData[r][4] = progress.toFixed(1);
    kabusaData[r][5] = status;
  }

  kabusaRange.setValues(kabusaData);
}

// =================================================================
// 4. 【重要】過去データを追加・訂正した後に「全再計算」する関数
// =================================================================
function recalculateAll() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  
  var summary = spreadsheet.getSheetByName("サマリー");
  if (summary) {
    var lastRow = summary.getLastRow();
    if (lastRow >= 2) summary.deleteRows(2, lastRow - 1);
  } else {
    summary = spreadsheet.insertSheet("サマリー");
  }
  summary.getRange(1, 1, 1, 6).setValues([["日付", "最高気温(℃)", "最低気温(℃)", "平均気温(℃)", "有効積算温度(℃・日)", "累計積算温度(℃・日)"]]);
  
  var dataSheet = spreadsheet.getSheetByName("データー");
  var lastDataRow = dataSheet.getLastRow();
  if (lastDataRow < 2) return;
  
  var data = dataSheet.getRange(2, 1, lastDataRow-1, 1).getValues();
  var uniqueDates = [];
  
  for (var i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    var d = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
    if (isNaN(d.getTime())) continue;
    var dStr = Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd");
    if (uniqueDates.indexOf(dStr) === -1) {
      uniqueDates.push(dStr);
    }
  }
  
  uniqueDates.sort();
  
  for (var j = 0; j < uniqueDates.length; j++) {
    updateSummary(spreadsheet, uniqueDates[j]);
  }
  
  updateKabusa(spreadsheet, Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd"));
  Logger.log("【大成功】すべての過去データに基づく正しい順序での再計算が完了しました！");
}

// =================================================================
// 5. 日常の動作テスト・日次手動更新用関数
// =================================================================
function runDailyUpdate() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");
  updateSummary(spreadsheet, todayStr);
  updateKabusa(spreadsheet, todayStr);
  Logger.log("日常のデータ更新が正常に完了しました。");
}