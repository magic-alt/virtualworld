#pragma once
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "glTFRuntimeParser.h"

namespace VW
{
using Json = TSharedPtr<FJsonObject>;
bool Parse(const FString& Text, Json& Result);
FString Serialize(const Json& Object);
FString Digest(const TArray<uint8>& Bytes);
FString DigestText(const FString& Text);
bool SafeId(const FString& Id);
inline FString String(const Json& Object, const TCHAR* Key, const FString& Default = FString())
{
    FString Value;
    return Object && Object->TryGetStringField(Key, Value) ? Value : Default;
}
inline double Number(const Json& Object, const TCHAR* Key, double Default = 0)
{
    double Value;
    return Object && Object->TryGetNumberField(Key, Value) ? Value : Default;
}
inline bool Bool(const Json& Object, const TCHAR* Key, bool Default = false)
{
    bool Value;
    return Object && Object->TryGetBoolField(Key, Value) ? Value : Default;
}
inline Json Object(const Json& Parent, const TCHAR* Key)
{
    const Json* Value = nullptr;
    return Parent && Parent->TryGetObjectField(Key, Value) ? *Value : nullptr;
}
inline TArray<TSharedPtr<FJsonValue>> Array(const Json& Parent, const TCHAR* Key)
{
    const TArray<TSharedPtr<FJsonValue>>* Value = nullptr;
    return Parent && Parent->TryGetArrayField(Key, Value) ? *Value : TArray<TSharedPtr<FJsonValue>>();
}
inline FVector Vector(const Json& Parent, const TCHAR* Key, const FVector& Default = FVector::ZeroVector)
{
    const auto A = Array(Parent, Key);
    return A.Num() == 3 ? FVector(A[0]->AsNumber(), A[1]->AsNumber(), A[2]->AsNumber()) : Default;
}
inline FQuat Quaternion(const Json& Parent, const TCHAR* Key)
{
    const auto A = Array(Parent, Key);
    return A.Num() == 4 ? FQuat(A[0]->AsNumber(), A[1]->AsNumber(), A[2]->AsNumber(), A[3]->AsNumber()).GetNormalized() : FQuat::Identity;
}
inline bool Contains(const Json& Parent, const TCHAR* Key, const FString& Id)
{
    for (const auto& Value : Array(Parent, Key)) if (Value->AsString() == Id) return true;
    return false;
}
inline bool Requires(const Json& Interaction, const TSet<FString>& Flags)
{
    for (const auto& Value : Array(Interaction, TEXT("requires"))) if (!Flags.Contains(Value->AsString())) return false;
    return true;
}
inline bool ChapterUnlocked(const Json& Campaign,const FString& Id,const TSet<FString>& SavedCompleted,const FString& LaunchScene)
{
    TSet<FString> ReachableCompleted;
    for(const auto& Value:Array(Campaign,TEXT("chapters")))
    {
        const Json Chapter=Value->AsObject();const FString ChapterId=String(Chapter,TEXT("id"));
        bool bUnlocked=true;
        for(const auto& Required:Array(Chapter,TEXT("requires"))) bUnlocked&=ReachableCompleted.Contains(Required->AsString());
        // An explicitly selected export/start chapter is playable on a fresh save.
        // Later menu transitions still require completed reachable prerequisites.
        if(ChapterId==LaunchScene) bUnlocked=true;
        if(ChapterId==Id) return bUnlocked;
        if(bUnlocked&&SavedCompleted.Contains(ChapterId)) ReachableCompleted.Add(ChapterId);
    }
    return true;
}
inline FglTFRuntimeConfig LoaderConfig()
{
    FglTFRuntimeConfig Config;
    Config.TransformBaseType = EglTFRuntimeTransformBaseType::Default;
    Config.SceneScale = 100.f;
    Config.bAllowExternalFiles = false;
    Config.bNoArchive = true;
    return Config;
}
inline FVector Position(const FVector& Source)
{
    const auto Config = LoaderConfig();
    return FVector(Config.GetMatrix().TransformPosition(Source)) * Config.SceneScale;
}
inline FVector SourcePosition(const FVector& Native)
{
    const auto Config = LoaderConfig();
    return FVector(Config.GetMatrix().Inverse().TransformPosition(Native / Config.SceneScale));
}
inline FQuat CharacterFacing()
{
    // Authored Prince actors face source +Z. Convert that frame once to local native +X/+Z.
    return FRotationMatrix::MakeFromXZ(Position(FVector(0,0,1)),Position(FVector(0,1,0))).ToQuat().Inverse();
}
inline FTransform Transform(const FVector& PositionMetres, const FQuat& Rotation, const FVector& Scale)
{
    const auto Config = LoaderConfig();
    const FMatrix Basis = Config.GetMatrix();
    FMatrix Source = FTransform(Rotation, PositionMetres, Scale).ToMatrixWithScale();
    Source.ScaleTranslation(FVector(Config.SceneScale));
    return FTransform(Basis.Inverse() * Source * Basis);
}
inline FQuat EulerXYZ(const FVector& Radians)
{
    const double C1=FMath::Cos(Radians.X/2),C2=FMath::Cos(Radians.Y/2),C3=FMath::Cos(Radians.Z/2);
    const double S1=FMath::Sin(Radians.X/2),S2=FMath::Sin(Radians.Y/2),S3=FMath::Sin(Radians.Z/2);
    return FQuat(S1*C2*C3+C1*S2*S3,C1*S2*C3-S1*C2*S3,C1*C2*S3+S1*S2*C3,C1*C2*C3-S1*S2*S3);
}
struct Harmonic
{
    double Ratio;
    double Output;
    float Cos;
    float Sin;
};
inline Harmonic Transmission(double Angle, double FlexTeeth, double RingTeeth)
{
    const double Ratio = -(RingTeeth-FlexTeeth)/FlexTeeth;
    const double Output = Angle*Ratio;
    return {Ratio, Output, static_cast<float>(FMath::Cos(2*(Angle-Output))), static_cast<float>(FMath::Sin(2*(Angle-Output)))};
}
}
