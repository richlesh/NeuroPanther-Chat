; Custom NSIS include for NeuroPanther Chat.
;
; electron-builder's assisted (non-oneClick) installer composes the default
; install directory as  $LOCALAPPDATA\Programs\<name>\<productName>, which for
; this app produced the doubled, ugly path
;   ...\Programs\neuropanther-chat\NeuroPanther Chat
; We want a single flat folder named after the product:
;   ...\Programs\NeuroPanther Chat
;
; multiUser.nsh picks up a pre-existing InstallLocation registry value before
; falling back to its computed default, so seeding that value in `preInit`
; makes the installer default to our flat path (the user can still change it).
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\NeuroPanther Chat"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\NeuroPanther Chat"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\NeuroPanther Chat"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES\NeuroPanther Chat"
!macroend
