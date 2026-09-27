# Hardware wiring

How to connect a HUB75 LED panel to the ESP32 for this firmware.

This is the physical side only. For flashing, credentials and declaring your
panel arrangement, see **[SETUP.md](SETUP.md)**.

---

## What you need

| | |
| --- | --- |
| **ESP32** | The build targets `upesy_wroom` - any ESP32 WROOM dev board works |
| **HUB75 panel(s)** | 64×64 modules. All panels in one wall must be identical |
| **5V power supply** | Sized for your wall - see [Power](#power) |
| **16-pin IDC ribbon** | Usually supplied with the panel |
| **Jumper wires** | ESP32 → panel IN connector |

**The ESP32's USB port cannot power a panel.** A single fully-lit 64×64 panel
draws around 4 A at 5 V. USB gives you 0.5 A. Attempting it browns out the
board and the panel flickers or shows garbage - this is the single most common
cause of "it doesn't work".

---

## At a glance

![HUB75 to ESP32 wiring diagram](docs/wiring.svg)

The sections below explain each part. If you only read one thing: the panel
needs its **own 5V supply**, and it must **share a ground** with the ESP32.

---

## The HUB75 connector

Panels have two 16-pin IDC headers: **IN** (sometimes `J1`) and **OUT** (`J2`).
The ESP32 goes to **IN**. Look for the arrow silkscreened on the PCB - it
points in the direction data flows, away from IN.

Pin 1 is marked on the board, usually with a small triangle, a square solder
pad, or a `1`. The ribbon cable's red stripe conventionally goes to pin 1.

Looking at the connector **from the front of the board, notch upward**:

```
        ┌──────∪──────┐
   R1   │  1   ·   2  │  G1
   B1   │  3   ·   4  │  GND
   R2   │  5   ·   6  │  G2
   B2   │  7   ·   8  │  E
    A   │  9   ·  10  │  B
    C   │ 11   ·  12  │  D
  CLK   │ 13   ·  14  │  LAT
   OE   │ 15   ·  16  │  GND
        └─────────────┘
```

Odd pins run down the left, even down the right. Some panels label `LAT` as
`STB` (strobe) and `OE` as `nOE` or `/OE` - same signal.

> **Pin 8 differs by panel type.** On 64×64 panels (1/32 scan) it is the **E**
> address line, as above. On 64×32 panels (1/16 scan) it is **GND**, and the
> E wire is simply left unconnected. Wiring E to a panel that expects GND there
> is a short - check your panel's scan rate before connecting pin 8.

---

## Pin map

Wire the panel's IN connector to these ESP32 GPIOs:

| HUB75 pin | Signal | ESP32 GPIO | What it does |
| ---: | --- | ---: | --- |
| 1 | R1 | **27** | Red, upper half |
| 2 | G1 | **26** | Green, upper half |
| 3 | B1 | **14** | Blue, upper half |
| 4 | GND | **GND** | Ground |
| 5 | R2 | **12** | Red, lower half |
| 6 | G2 | **25** | Green, lower half |
| 7 | B2 | **15** | Blue, lower half |
| 8 | E | **5** | Row address bit 4 (64×64 only - GND on 64×32) |
| 9 | A | **32** | Row address bit 0 |
| 10 | B | **17** | Row address bit 1 |
| 11 | C | **33** | Row address bit 2 |
| 12 | D | **16** | Row address bit 3 |
| 13 | CLK | **1** | Pixel clock |
| 14 | LAT | **2** | Latch / strobe |
| 15 | OE | **4** | Output enable (active low) |
| 16 | GND | **GND** | Ground |

Ground appears twice on the connector. Connect **at least one**; connecting
both is better for signal integrity on longer ribbons.

The panel is driven in two halves simultaneously - that's why there are two sets
of RGB lines. R1/G1/B1 feed the top 32 rows, R2/G2/B2 the bottom 32.

### If you're wiring from scratch

Any GPIOs work. Change the `pins` struct in `setupMatrix()`
(`src/main.cpp`) to match, keeping this exact order:

```c
HUB75_I2S_CFG::i2s_pins pins = {
    27, 26, 14,          // r1, g1, b1
    12, 25, 15,          // r2, g2, b2
    32, 17, 33, 16, 5,   // a, b, c, d, e
    2, 4, 1              // lat, oe, clk
};
```

Two cautions if you pick your own pins:

- **GPIO 1 and 3 are the USB serial TX/RX.** This build uses GPIO 1 for CLK,
  which works but means serial output is unreliable while the panel is running.
  If you want a clean serial log for debugging, move CLK to a free pin.
- **GPIO 34-39 are input-only** and cannot drive a panel. GPIO 6-11 are wired
  to the flash chip and must not be used at all.

---

## If your board is a generic ESP32 DevKit

The build targets `upesy_wroom`, but a DOIT / ESP32-DevKitC / NodeMCU-32S board
is the same ESP32-WROOM-32 chip. Two things to change.

### 1. Board id

In [`platformio.ini`](platformio.ini):

```ini
board = esp32dev      ; was: upesy_wroom
```

`esp32dev` is the generic WROOM target and works for essentially every 30-pin
and 38-pin DevKit. Nothing else in the build changes.

While you're in there: `lib_extra_dirs` points at a local Arduino libraries
folder on the original machine. If PlatformIO complains about it, delete that
line - everything needed is in `lib_deps`.

### 2. The pin map may stop the board booting

This matters more. **The default map above uses all four ESP32 strapping pins**
- GPIO 12, 15, 5 and 2 - which the chip reads at power-on to decide how to
start:

| GPIO | Signal here | What the chip does with it at boot |
| ---: | --- | --- |
| **12** | R2 | **If high at boot, sets flash to 1.8 V and the board will not start** |
| 15 | B2 | If low, silences the boot log |
| 5 | E | Sets SDIO timing |
| 2 | LAT | Must be low or floating to boot normally |

GPIO 12 is the dangerous one. A panel connected to it can hold the line high
through its input buffer, and the symptom is a board that works fine on its own
but goes dead - no serial, no boot - the moment the ribbon is plugged in.

Whether it bites you depends on the panel. Some drive the line low, some
don't. **If your current wiring boots and runs, leave it alone.** If it
doesn't, that's the cause.

### A DevKit-safe alternative map

This avoids every strapping pin, both UART pins, the flash pins (6-11) and the
input-only pins (34-39):

| Signal | GPIO | | Signal | GPIO |
| --- | ---: | --- | --- | ---: |
| R1 | 25 | | A | 23 |
| G1 | 26 | | B | 19 |
| B1 | 27 | | C | 18 |
| R2 | 14 | | D | 17 |
| G2 | 13 | | E | 16 |
| B2 | 4 | | LAT | 21 |
| CLK | 33 | | OE | 22 |

Put it in `setupMatrix()` in [`src/main.cpp`](src/main.cpp), keeping the order:

```c
HUB75_I2S_CFG::i2s_pins pins = {
    25, 26, 27,          // r1, g1, b1
    14, 13, 4,           // r2, g2, b2
    23, 19, 18, 17, 16,  // a, b, c, d, e
    21, 22, 33           // lat, oe, clk
};
```

This also frees **GPIO 1**, so the serial monitor stays readable while the panel
runs - worth having when you're debugging wiring.

> Two caveats. If your module is an **ESP32-WROVER** (has PSRAM), GPIO 16 and 17
> are wired to the PSRAM and can't be used - move E and D to 32 and 33, and put
> CLK somewhere else. And **I have not tested this map on hardware**; it is
> derived from the ESP32 pin restrictions, not from a working build. Change one
> thing at a time and keep the serial monitor open.

### 30-pin vs 38-pin

Both expose everything this firmware needs. The 30-pin board simply omits some
GND/unusable pins. Note that on a 30-pin board the header labels skip around -
go by the **GPIO number printed on the silkscreen**, not by counting pin
positions.

---

## Power

Panel power is **separate** from the ESP32. Do not try to feed the panel from
the ESP32's 5V pin.

```
   5V PSU ──┬── panel 5V  (screw terminal / spade connector on the panel)
            └── ESP32 5V/VIN            ← optional, if not powering by USB

   PSU GND ─┬── panel GND
            └── ESP32 GND               ← REQUIRED
```

**The ESP32 and the panel must share a ground.** Without it the data lines have
no common reference and you get flicker, wrong colours, or nothing at all -
even though everything looks correctly wired.

Budget roughly **4 A per 64×64 panel** at full white. Real content draws far
less, but size the supply for the worst case or bright scenes will brown out.
A 3×3 wall of nine panels is a ~36 A budget - that is a serious supply, and
you should inject power to each panel rather than daisy-chaining power through
the ribbon.

---

## Chaining panels

Data chaining needs **no extra GPIO wiring**. Panel 1's **OUT** goes to panel
2's **IN**, and so on:

```
ESP32 ──▶ [IN] Panel 1 [OUT] ──▶ [IN] Panel 2 [OUT] ──▶ [IN] Panel 3
```

The address and data lines fan through the whole chain electrically. Only the
first panel connects to the ESP32.

Power is the exception - **run 5V to every panel from the supply**, not through
the chain. The ribbon cannot carry tens of amps.

Once wired, tell the firmware the shape in
[`include/panel_config.h`](include/panel_config.h):

```c
#define PANEL_GRID_ROWS 3   // panels tall
#define PANEL_GRID_COLS 3   // panels wide
#define PANEL_CHAIN_TYPE CHAIN_TOP_LEFT_DOWN   // how the chain snakes
```

`CHAIN_TOP_LEFT_DOWN` means the chain starts at the top-left panel and
serpentines downward. If yours snakes differently, pick another value from the
`PANEL_CHAIN_TYPE` enum in `VirtualMatrixPanel_T.hpp`. Rearranging panels means
editing this file and reflashing - it is a compile-time constant because the
driver needs it before any network traffic happens.

---

## Checking it works

Flash the firmware (see [SETUP.md](SETUP.md)), then use the **Identify** button
on the web app's Devices page. It pushes a test pattern, which is the quickest
way to confirm orientation and chain order without reading serial logs.

| Symptom | Usual cause |
| --- | --- |
| Nothing lights at all | Panel 5V absent, or no shared ground with the ESP32 |
| Flickering, dim, or random pixels | Undersized supply, or missing common ground |
| Colours wrong (red↔blue) | R and B lines swapped - check pins 1/3 and 5/7 |
| Top half fine, bottom half dark | R2/G2/B2 (pins 5-7) not connected |
| Image doubled or squashed vertically | Wrong scan rate - check pin 8 (E) and `PANEL_RES_Y` |
| Panels in the wrong order | `PANEL_CHAIN_TYPE` doesn't match how you wired the chain |
| Serial monitor unreadable | GPIO 1 is CLK on this build - see the caution above |

More troubleshooting in [SETUP.md](SETUP.md#troubleshooting).
