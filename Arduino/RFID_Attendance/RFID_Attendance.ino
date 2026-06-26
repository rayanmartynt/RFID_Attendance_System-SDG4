#include <SPI.h>
#include <MFRC522.h>
#include <LiquidCrystal.h>

// RFID Pins
#define SS_PIN 10
#define RST_PIN 9

//BUZZER
#define BUZZER A2

// LEDs
#define GREEN_LED 2
#define RED_LED1 3
#define BLUE_LED 4

// LCD Pins
LiquidCrystal lcd(7, 6, 5, 8, A0, A1);

MFRC522 rfid(SS_PIN, RST_PIN);

void setup()
{
  Serial.begin(9600);

  SPI.begin();
  rfid.PCD_Init();

  pinMode(BUZZER, OUTPUT);

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED1, OUTPUT);
  pinMode(BLUE_LED, OUTPUT);

  lcd.begin(16, 2);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("RFID ATTENDANCE");

  lcd.setCursor(0, 1);
  lcd.print("SCAN CARD");

  delay(2000);
}

void loop()
{
  // Wait for card
  if (!rfid.PICC_IsNewCardPresent())
    return;

  if (!rfid.PICC_ReadCardSerial())
    return;

  // Read UID
  String uid = "";

  for (byte i = 0; i < rfid.uid.size; i++)
  {
    if (rfid.uid.uidByte[i] < 0x10)
      uid += "0";

    uid += String(rfid.uid.uidByte[i], HEX);
  }

  uid.toUpperCase();

  // Send UID to Python
  Serial.println(uid);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("PROCESSING...");

  tone(BUZZER, 2000);
  delay(200);
  noTone(BUZZER);


  unsigned long startTime = millis();

  while (millis() - startTime < 5000)
  {
    if (Serial.available())
    {
      String message = Serial.readStringUntil('\n');
      message.trim();

      Serial.print("Received: ");
      Serial.println(message);

      if (message.startsWith("PRESENT:"))
      {
        String name = message.substring(8);

        digitalWrite(GREEN_LED, HIGH);

        tone(BUZZER, 1000);
        delay(200);
        noTone(BUZZER);

        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("WELCOME");

        lcd.setCursor(0, 1);
        lcd.print(name);

        delay(2000);

        digitalWrite(GREEN_LED, LOW);
      }

      else if (message.startsWith("CHECKOUT:"))
      {
        String name = message.substring(9);

        digitalWrite(GREEN_LED, HIGH);

        tone(BUZZER, 1200);
        delay(200);
        noTone(BUZZER);

        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("GOODBYE");

        lcd.setCursor(0, 1);
        lcd.print(name);

        delay(3000);

        digitalWrite(GREEN_LED, LOW);
      }

      else if (message == "DUPLICATE")
      {
        digitalWrite(BLUE_LED, HIGH);

        tone(BUZZER, 500);
        delay(800);
        noTone(BUZZER);

        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("ALREADY");

        lcd.setCursor(0, 1);
        lcd.print("RECORDED");

        delay(3000);

        digitalWrite(BLUE_LED, LOW);
      }

      else if (message == "NOTFOUND")
      {
        digitalWrite(RED_LED1, HIGH);

        tone(BUZZER, 800);
        delay(150);
        noTone(BUZZER);

        delay(100);

        tone(BUZZER, 800);
        delay(150);
        noTone(BUZZER);

        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("UNKNOWN");

        lcd.setCursor(0, 1);
        lcd.print("CARD");

        delay(3000);

        digitalWrite(RED_LED1, LOW);
      }

      break;
    }
  }

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("SCAN CARD");

  lcd.setCursor(0, 1);
  lcd.print("READY");

  rfid.PICC_HaltA();
}