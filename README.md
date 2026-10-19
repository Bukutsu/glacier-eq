# Glacier EQ

Edit the parametric EQ stored on your USB DAC dongle. Your settings stay on the DAC when you use it with another device.

[Open the web app](https://bukutsu.github.io/glacier-eq/) (Chrome or Edge) · [Download for desktop or Android](https://github.com/Bukutsu/glacier-eq/releases)

<img src="assets/screenshot-main.png" alt="Glacier EQ showing EQ sliders and sound curve" width="900">

Glacier EQ works offline and needs no account. Desktop builds with automatic updates check GitHub once at launch; nothing else is sent.

## Check your DAC

**Tested for hardware EQ:** EPZ TP35 Pro, FiiO JA11, TRN Black Pearl.

**Tested, sound controls only:** Moondrop Dawn Pro. It has no hardware EQ, but you can export EQ for a system equalizer.

**Supported, not yet tested:**
- Audiocular Aura
- FiiO KA series (KA5, KA13, etc.)
- Fosi Audio DS2
- iBasso DC04 Pro
- JCally JM12, JM20, and JM20 Pro
- Moondrop Dawn Pro 2
- Truthear KEYX

Other Savitech- or Walkplay-based DAC dongles may work. See the [full device list](https://github.com/Bukutsu/glacier-eq/wiki/Supported-Devices). If you try an untested device, [tell us how it went](https://github.com/Bukutsu/glacier-eq/issues).

## Use it

1. Choose **Connect DAC** and select your device.
2. Choose **Read from DAC**, or use **Tuning** to generate EQ from a headphone measurement and target curve.
3. Adjust the filters and choose **Write to DAC** (**Save to DAC** on mobile).

Loading a profile only changes the editor. Write it to the DAC to save it. Compatible DACs also let you try an EQ temporarily without saving.

Linux connection issues? See the [setup and troubleshooting guide](https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting).

## License

GPL-3.0-only. See [LICENSE](LICENSE).
