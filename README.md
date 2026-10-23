# Glacier EQ

Edit the parametric EQ stored on your USB DAC dongle. Your settings stay on the DAC when you use it with another device.

[Open the web app](https://bukutsu.github.io/glacier-eq/) (Chrome or Edge) · [Download for desktop or Android](https://github.com/Bukutsu/glacier-eq/releases)

<img src="assets/screenshot-main.png" alt="Glacier EQ showing EQ sliders and sound curve" width="900">

Glacier EQ works offline and needs no account.

## Check your DAC

[Search supported devices](https://bukutsu.github.io/glacier-eq/#/supported-devices)
to find your model and its test status. The catalog comes from the same device
registry as the deployed web app, so it updates with each web build. You can
search by model, family, chip, or USB ID and filter by test status.

EQ support and extra controls are listed separately. An untested profile still
needs confirmation on real hardware, and a model entry does not guarantee every
firmware or USB mode works. See [FiiO protocol notes](docs/fiio-support.md) for
transport limits and source evidence.

If you try an untested device,
[tell us how it went](https://github.com/Bukutsu/glacier-eq/issues).

## Use it

1. Choose **Connect DAC** and select your device.
2. Choose **Read from DAC**, or use **Tuning** to generate EQ from a headphone measurement and target curve. AutoEQ optimizes the result for your DAC's filter capabilities.
3. Adjust the filters and choose **Write to DAC** (**Save to DAC** on mobile).

Loading a profile only changes the editor. Write it to the DAC to save it, or use **Use on DAC** on mobile to do both. Compatible DACs also let you try an EQ temporarily without saving, and hold **A/B** to hear the DAC without EQ.

On Android, you can turn on **Open when a DAC is plugged in** (Settings > General) so plugging in a supported DAC offers to open Glacier EQ.

Linux connection issues? See the [setup and troubleshooting guide](https://github.com/Bukutsu/glacier-eq/wiki/Troubleshooting).

## License

GPL-3.0-only. See [LICENSE](LICENSE).
