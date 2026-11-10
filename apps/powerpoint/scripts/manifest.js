// Writes a manifest for a given origin:
//   node scripts/manifest.js                          -> manifest.xml (https://localhost:3000, dev)
//   node scripts/manifest.js https://prompter.example.com -> dist/manifest.prompter.example.com.xml
// Production panes are served by apps/web under /powerpoint/.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

/**
 * Manifest XML for an origin. `dev` = the Vite dev server serves the pane at the root;
 * otherwise the web app serves it under /powerpoint/. `id` keeps the add-in identity stable.
 */
function buildManifest(origin, { dev = false, id = randomUUID() } = {}) {
  origin = origin.replace(/\/$/, "");
  const base = dev ? `${origin}` : `${origin}/powerpoint`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
  xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides"
  xsi:type="TaskPaneApp">
  <Id>${id}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Filow</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Filow"/>
  <Description DefaultValue="Your speaker notes become live talking points that get checked off as you say them."/>
  <IconUrl DefaultValue="${base}/assets/icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="${base}/assets/icon-64.png"/>
  <SupportUrl DefaultValue="${origin}"/>
  <AppDomains>
    <AppDomain>${origin}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Presentation"/>
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.1">
      <Set Name="PowerPointApi" MinVersion="1.4"/>
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${base}/index.html"/>
  </DefaultSettings>
  <Permissions>ReadDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Presentation">
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMoreUrl"/>
          </GetStarted>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="Filow.Group">
                <Label resid="Group.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16"/>
                  <bt:Image size="32" resid="Icon.32"/>
                  <bt:Image size="80" resid="Icon.80"/>
                </Icon>
                <Control xsi:type="Button" id="Filow.Open">
                  <Label resid="Open.Label"/>
                  <Supertip>
                    <Title resid="Open.Label"/>
                    <Description resid="Open.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16"/>
                    <bt:Image size="32" resid="Icon.32"/>
                    <bt:Image size="80" resid="Icon.80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>Filow.Pane</TaskpaneId>
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16" DefaultValue="${base}/assets/icon-16.png"/>
        <bt:Image id="Icon.32" DefaultValue="${base}/assets/icon-32.png"/>
        <bt:Image id="Icon.80" DefaultValue="${base}/assets/icon-80.png"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="${origin}"/>
        <bt:Url id="Taskpane.Url" DefaultValue="${base}/index.html"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GetStarted.Title" DefaultValue="Filow"/>
        <bt:String id="Group.Label" DefaultValue="Filow"/>
        <bt:String id="Open.Label" DefaultValue="Open Filow"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Open the Filow pane, load your notes, and rehearse."/>
        <bt:String id="Open.Tooltip" DefaultValue="Speaker notes become live talking points."/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`;
}

module.exports = { buildManifest };
if (require.main !== module) return;

const origin = (process.argv[2] || "https://localhost:3000").replace(/\/$/, "");
const dev = !process.argv[2];
const idFile = path.join(__dirname, "..", ".manifest-id");
// The add-in's identity. A local .manifest-id wins; otherwise the Id already in the tracked
// manifest.xml is kept, so a build in a fresh checkout does not rewrite that file with a random Id
// (Office treats a new Id as a different add-in). A random Id is only made when neither exists.
const trackedManifest = path.join(__dirname, "..", "manifest.xml");
const trackedId = fs.existsSync(trackedManifest) ? (/<Id>([0-9a-f]{8}-[0-9a-f-]{27})<\/Id>/i.exec(fs.readFileSync(trackedManifest, "utf8")) || [])[1] : undefined;
const id = fs.existsSync(idFile) ? fs.readFileSync(idFile, "utf8").trim() : trackedId || (() => { const v = randomUUID(); fs.writeFileSync(idFile, v); return v; })();
const xml = buildManifest(origin, { dev, id });
const out = dev ? path.join(__dirname, "..", "manifest.xml") : path.join(__dirname, "..", "dist", `manifest.${origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]/gi, "_")}.xml`);
fs.mkdirSync(path.dirname(out), { recursive: true });
// Same text apart from line endings (a Windows checkout has CRLF): leave the file alone, so a build
// does not show a tracked file as changed.
const same = fs.existsSync(out) && fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") === xml.replace(/\r\n/g, "\n");
if (!same) fs.writeFileSync(out, xml);
console.log(same ? "unchanged" : "wrote", path.relative(process.cwd(), out));
