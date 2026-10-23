using UnrealBuildTool;
using System.Collections.Generic;

public class VirtualWorldTarget : TargetRules
{
    public VirtualWorldTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("VirtualWorld");
    }
}
