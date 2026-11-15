# Smart Markup for Acrobat — test guide

Thanks for testing! This plug-in links your comments and markups to the Revit building elements under
them and stores the links inside the PDF. It needs **Acrobat Pro or Standard** on Windows (64-bit);
the free Reader cannot load it. Nothing here touches anything outside Acrobat's plug-in folder.

Allow ~15 minutes. Please send back the files listed under "What to send back".

## 1. Install (once, ~2 min)

1. Unzip this folder somewhere, e.g. `C:\SmartMarkupTest`.
2. **Close Acrobat completely.**
3. Open **PowerShell as administrator** (Start → type PowerShell → right-click → Run as administrator) and run:

   ```powershell
   cd C:\SmartMarkupTest
   powershell -ExecutionPolicy Bypass -File .\Install-Plugin.ps1 -Copy -BuildDir .
   ```

   If your Acrobat is installed elsewhere, add `-AcrobatDir "<folder that contains Acrobat.exe>"`.
4. Start Acrobat. In **Edit → Preferences → General**, make sure **"Use only certified plug-ins"** is
   **unticked** (restart Acrobat if you change it).
5. Check **Help → About Adobe Plug-ins**: **SmartMarkup** should be listed. In the new Acrobat UI the
   plug-in's own menu, **Smart Markup**, is under *Menu → Plug-ins*.

## 2. Automatic self-test (~2 min)

Close Acrobat, then in a normal (non-admin) PowerShell:

```powershell
cd C:\SmartMarkupTest
powershell -ExecutionPolicy Bypass -File .\Run-SelfTest.ps1 -Pdf .\snowdon-a101-enhanced.pdf -Out .\results -Steps ping,elementmap,lifecycle-open,inspect,overlay,addmarkup
```

Acrobat opens briefly by itself, runs the checks and closes again. If it stays open with a
"Save changes?" prompt, choose **No** and close it. The script prints the results and writes
`results\selftest.json`.

## 3. Try it by hand (~10 min)

Open `snowdon-a101-enhanced.pdf` in Acrobat.

- **Inspect:** *Smart Markup → Inspect elements* (turn it on). Click a wall: a window lists its
  properties (Fire Rating, Function, …) and the wall is outlined in orange/yellow. Click another element:
  the highlight moves. Click empty paper or turn Inspect off: it disappears.
- **Linking:** turn Inspect off. Draw a **cloud** around a wall with Acrobat's own tool and type a comment.
  Add a **sticky note** on a door. Save (**Ctrl+S**).
- **Linked highlight:** click your cloud to select it: the elements it is linked to are outlined. Click
  elsewhere: the outline goes away.
- **Nothing should change** about how your markups look, and closing a file you only *looked at* should
  not ask "Save changes?".

## 4. "Upgrade" test: markups made WITHOUT the plug-in (~5 min)

This checks that markups someone made without the plug-in (plain Acrobat, Reader, Bluebeam, …) get
linked when the PDF is opened with it.

1. Make a copy: `snowdon-a101-enhanced.pdf` → `upgrade-test.pdf`.
2. **Before installing the plug-in** (or on a machine/viewer without it — Reader or Edge works), open
   `upgrade-test.pdf`, add a cloud or rectangle around a wall, an arrow pointing at a door and a text box
   that mentions an element ID (e.g. "see wall 676281"). Save and close.
   *(If the plug-in is already installed: run `Uninstall-Plugin.ps1` first, do this step, then install again.)*
3. With the plug-in installed, open `upgrade-test.pdf` in Acrobat. It should now say the file has
   changes (the plug-in linked your markups). Save (**Ctrl+S**).
4. Select each markup: its elements should be outlined (linked highlight). Send back `upgrade-test.pdf`.

## What to send back

- `results\selftest.json` and the `results` folder (it contains `saved.pdf`),
- the PDF you marked up and saved in step 3, and `upgrade-test.pdf` from step 4,
- the log file `%LOCALAPPDATA%\SmartMarkup\smartmarkup.log`,
- a screenshot of anything odd (and a few words on what you clicked).

## Uninstall

Close Acrobat, then in an administrator PowerShell in the same folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\Uninstall-Plugin.ps1
```
