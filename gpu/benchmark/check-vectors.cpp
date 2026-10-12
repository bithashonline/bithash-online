#include <iostream>
#include "AddressUtil.h"
#include "vectors.h"
int main(){
  unsigned int checked=0;
  for(const auto&v:vectors)for(const auto&t:v.targets){
    const uint64_t n=t.offset<0?v.start-1:v.start+static_cast<uint64_t>(t.offset);
    auto p=secp256k1::multiplyPoint(secp256k1::uint256(n),secp256k1::G());
    if(Address::fromPublicKey(p,true)!=t.address)return 1;
    if((n>=v.start&&n<v.start+v.count)!=t.expected)return 1;
    checked++;
  }
  std::cout<<"Independent C++ reference agrees with all "<<checked<<" Node/OpenSSL vectors"<<std::endl;
}
