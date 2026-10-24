using UnrealBuildTool;

public class VirtualWorld : ModuleRules
{
    public VirtualWorld(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] {
            "Core", "CoreUObject", "Engine", "InputCore", "Json", "JsonUtilities", "glTFRuntime", "ProceduralMeshComponent"
        });
        PrivateDependencyModuleNames.AddRange(new string[] { "Slate", "SlateCore" });
        if (Target.bBuildEditor) PrivateDependencyModuleNames.Add("DesktopPlatform");
        if (Target.Platform == UnrealTargetPlatform.Win64)
            PublicSystemLibraries.Add("comdlg32.lib");
    }
}
