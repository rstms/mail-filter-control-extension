# Mail Filter Control Extension

A thunderbird mail extension providing interface elements and a Control Panel page for configuring mail filtering features of the Reliance Systems mailserver

## Description
This software is a Thunderbird Add-On which adds custom context menus and a control panel page.  These menus and controls are used configure mail filtering and routing features.  The extension is compatible with Thunderbird and Betterbird.  The extension software is made available as a downloadable XPI archive file.  The extension is designed to interact with the “enhanced mail filter” features present in Reliance Systems mail servers.

## Download the XPI file
1. In your web browser, open https://github.com/rstms/mail-filter-control-extension/releases
2. Right click on the latest XPI file and choose “Save link as...”
3. Select a location, (Downloads is the default) and download the file

## Install the extension into Thunderbird

1. Open Thunderbird and click the “three bars” menu in the upper right corner
2. Click on “Add-on and Themes” to open the Add-ons Manager window
3. If “Mail Filter Control” is listed under “Manage Your Extensions”, follow the steps below under “Remove the extension from Thunderbird”, then restart this procedure.
4. To the right of “Manage Your Extensions, click the gear icon, and chose “Install Add-on from File...”
5. Select the downloaded XPI file
6. In the “Add Mail Filter Control” popup, click “Add”
7. You should see “Mail Filter Control was added” - Click “Ok”							
8. Review the information under the extension’s “Options” tab and click “I Authorize these actions”.  This will switch to the extension’s Details tab.
9. Click the extension’s Options tab, then click “Open Mail Filter Controls”
10. In the section to the right of “Enabled Mail Filter Domains”, click to selected the desired domains
11. Click “Reset to Apply Changes” - the extension is now installed and enabled.
       
## Remove the extension from Thunderbird
1. Open Thunderbird
2. Click the “three bars” menu in the upper right corner
3. Click on “Add-on and Themes”.   This will open the Add-ons Manager window.   
4. Under “Manage Your Extensions”, locate the “Mail Filter Control” extension.
5. Click the associated “three-dots” menu, then click “Remove”.
6. Close Thunderbird to complete the removal.

### References:
 - https://www.thunderbird.net/en-US/desktop/
 - https://www.betterbird.eu/
 - https://www.opensmtpd.org
 - https://rspamd.com
 - https://github.com/rstms/filter-rspamd-class
 - https://github.com/rstms/filterctl
 - https://github.com/rstms/filterctld
