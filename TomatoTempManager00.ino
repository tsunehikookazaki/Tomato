#include <WiFiS3.h>
#include <WiFiSSLClient.h>
#include <DHT.h>
#include "Arduino_LED_Matrix.h"

ArduinoLEDMatrix matrix;

// ===== WiFi =====
const char* ssid = "xxxxxxxx";
const char* password = "xxxxxxx";

// ===== GAS =====
const char* host = "script.google.com";
const char* gas_url = "/macros/xxxxxxxxxxxxxxxxxxx/exec";

// ===== DHT11 =====
#define DHTPIN 2
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// ===== 8x5フォント=====
const uint8_t font[][8] = {
{0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110,0b00000}, //0
{0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110,0b00000}, //1
{0b01110,0b10001,0b00001,0b00010,0b00100,0b01000,0b11111,0b00000}, //2
{0b11110,0b00001,0b00001,0b01110,0b00001,0b00001,0b11110,0b00000}, //3
{0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010,0b00000}, //4
{0b11111,0b10000,0b11110,0b00001,0b00001,0b10001,0b01110,0b00000}, //5
{0b00110,0b01000,0b10000,0b11110,0b10001,0b10001,0b01110,0b00000}, //6
{0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000,0b00000}, //7
{0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110,0b00000}, //8
{0b01110,0b10001,0b10001,0b01111,0b00001,0b00010,0b01100,0b00000}, //9
{0b00000,0b00000,0b00000,0b00000,0b00000,0b00100,0b00000,0b00000}, //.
{0b01110,0b10001,0b10000,0b10000,0b10000,0b10001,0b01110,0b00000}, //C
{0b00110,0b01001,0b01001,0b00110,0b00000,0b00000,0b00000,0b00000}  //°
};

// ===== 文字列 =====
String text = "28.6*C";

int offset = 0;

//更新間隔
unsigned long lastScroll = 0;
unsigned long lastTemp = 0;
unsigned long lastSend = 0;

// ===== WiFi接続 =====
void connectWiFi() {
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
  }
}

// ===== GAS送信 =====
void sendToGAS(float t, float h) {

 WiFiSSLClient client;   // ★ここで作る

  String url = String(gas_url) + "?temperature=" + String(t, 1)  + "&humidity=" + String(h, 1);  // ★ここで作る

Serial.println(url);  // ★デバッグ用（重要）

  if (!client.connect(host, 443)) return;

  String params = "temp=" + String(t,1) + "&hum=" + String(h,1);

  String request = String("GET ") + url + "?" + params +
                   " HTTP/1.1\r\n" +
                   "Host: " + host + "\r\n" +
                   "Connection: close\r\n\r\n";

  client.print(request);

  while (client.connected()) {
    String line = client.readStringUntil('\n');
    if (line == "\r") break;
  }

  client.stop();
}



// ===== フォントindex =====
int getIndex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c == '.') return 10;
  if (c == 'C') return 11;
  if (c == '*') return 12;
  return -1;
}

// ===== 描画 =====
void draw(uint8_t frame[8][12], int off) {

  for (int y = 0; y < 8; y++)
    for (int x = 0; x < 12; x++)
      frame[y][x] = 0;

  int col = 12 - off;

  for (int i = 0; i < text.length(); i++) {

    char c = text[i];

    if (c == ' ') { col += 4; continue; }

    int f = getIndex(c);
    if (f < 0) { col += 4; continue; }

    for (int x = 0; x < 5; x++) {
      for (int y = 0; y < 8; y++) {

        int sx = col + x;
        int sy = y;

        if (sx >= 0 && sx < 12 && sy < 8) {
          frame[sy][sx] =
            (font[f][y] >> (4 - x)) & 1;
        }
      }
    }

    col += 6;
  }
}

void setup() {
  matrix.begin();
  dht.begin();
  connectWiFi();

Serial.begin(115200);
Serial.println("START");

}

void loop() {

  // ===== 温度更新（2秒ごと）=====
  if (millis() - lastTemp > 2000) {
    lastTemp = millis();

    float t = dht.readTemperature();

    if (!isnan(t)) {
      text = String(t, 1) + "*C";
    }
  }

   // ===== スクロール =====
  if (millis() - lastScroll > 80) {
    lastScroll = millis();

    uint8_t frame[8][12];
    draw(frame, offset);

    matrix.renderBitmap(frame, 8, 12);

    int totalWidth = text.length() * 6 + 12;
    offset++;
    if (offset > totalWidth) {
      offset = 0;
    }
  }

  //=====GAS送信===========
 if (millis() - lastSend > 3600000) {
//   if (millis() - lastSend > 6000) {
  lastSend = millis();

  float t = dht.readTemperature();
  float h = dht.readHumidity();

   Serial.println("SEND TRIGGER");

  if (!isnan(t) && !isnan(h)) {
    sendToGAS(t, h);
  }
}
}