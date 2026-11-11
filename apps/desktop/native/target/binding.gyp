{
  "targets": [
    {
      "target_name": "filow_target",
      "conditions": [
        ["OS=='win'", {
          "sources": ["src/target.cc"],
          "libraries": ["ole32.lib", "oleaut32.lib", "user32.lib", "advapi32.lib"],
          "msvs_settings": { "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/utf-8"] } }
        }]
      ]
    }
  ]
}
