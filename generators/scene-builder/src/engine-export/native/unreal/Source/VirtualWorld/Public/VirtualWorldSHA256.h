#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

// SHA-256 (FIPS 180-4). This independent helper also has executable known-vector tests.
namespace VirtualWorldDigest
{
inline std::string SHA256(const uint8_t* Data, size_t Size)
{
    static constexpr uint32_t K[64] = {
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    };
    std::array<uint32_t, 8> H = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    const auto R = [](uint32_t X, unsigned N) { return (X >> N) | (X << (32-N)); };
    const size_t Blocks = (Size + 9 + 63) / 64;
    const uint64_t Bits = static_cast<uint64_t>(Size) * 8;
    for (size_t Block = 0; Block < Blocks; ++Block)
    {
        uint32_t W[64] = {};
        for (size_t I = 0; I < 64; ++I)
        {
            const size_t Position = Block * 64 + I;
            uint8_t Byte = Position < Size ? Data[Position] : Position == Size ? 0x80 : 0;
            if (Position >= Blocks * 64 - 8) Byte = static_cast<uint8_t>(Bits >> (8 * (Blocks * 64 - Position - 1)));
            W[I/4] |= uint32_t(Byte) << (24 - 8*(I%4));
        }
        for (size_t I = 16; I < 64; ++I)
        {
            const uint32_t S0 = R(W[I-15],7)^R(W[I-15],18)^(W[I-15]>>3);
            const uint32_t S1 = R(W[I-2],17)^R(W[I-2],19)^(W[I-2]>>10);
            W[I] = W[I-16]+S0+W[I-7]+S1;
        }
        uint32_t A=H[0],B=H[1],C=H[2],D=H[3],E=H[4],F=H[5],G=H[6],V=H[7];
        for (size_t I=0; I<64; ++I)
        {
            const uint32_t T1=V+(R(E,6)^R(E,11)^R(E,25))+((E&F)^((~E)&G))+K[I]+W[I];
            const uint32_t T2=(R(A,2)^R(A,13)^R(A,22))+((A&B)^(A&C)^(B&C));
            V=G;G=F;F=E;E=D+T1;D=C;C=B;B=A;A=T1+T2;
        }
        H[0]+=A;H[1]+=B;H[2]+=C;H[3]+=D;H[4]+=E;H[5]+=F;H[6]+=G;H[7]+=V;
    }
    static constexpr char Hex[]="0123456789abcdef";
    std::string Result(64,'0');
    for (size_t I=0;I<8;++I) for (size_t J=0;J<8;++J) Result[I*8+J]=Hex[(H[I]>>(28-4*J))&15];
    return Result;
}
}
