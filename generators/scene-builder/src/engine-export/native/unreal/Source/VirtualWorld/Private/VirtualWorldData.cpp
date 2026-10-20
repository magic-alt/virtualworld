#include "VirtualWorldData.h"
#include "VirtualWorldSHA256.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace VW
{
bool Parse(const FString& Text, Json& Result)
{
    return FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Result) && Result.IsValid();
}
FString Serialize(const Json& Object)
{
    FString Result;
    FJsonSerializer::Serialize(Object.ToSharedRef(), TJsonWriterFactory<>::Create(&Result));
    return Result;
}
FString Digest(const TArray<uint8>& Bytes)
{
    return UTF8_TO_TCHAR(VirtualWorldDigest::SHA256(Bytes.GetData(), static_cast<size_t>(Bytes.Num())).c_str());
}
FString DigestText(const FString& Text)
{
    FTCHARToUTF8 Bytes(*Text);
    return UTF8_TO_TCHAR(VirtualWorldDigest::SHA256(reinterpret_cast<const uint8_t*>(Bytes.Get()), static_cast<size_t>(Bytes.Length())).c_str());
}
bool SafeId(const FString& Id)
{
    if (Id.IsEmpty() || Id.Len()>100) return false;
    for (TCHAR C : Id) if (!((C>='a' && C<='z') || (C>='A' && C<='Z') || (C>='0' && C<='9') || C=='_' || C=='-')) return false;
    return true;
}
}
