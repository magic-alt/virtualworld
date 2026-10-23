using UnrealBuildTool;
using System.Collections.Generic;

public class VirtualWorldEditorTarget : TargetRules
{
    public VirtualWorldEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("VirtualWorld");
    }
}
