using UnrealBuildTool;
using System.Collections.Generic;

public class VirtualWorldEditorTarget : TargetRules
{
    public VirtualWorldEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("VirtualWorld");
    }
}
