#include <iostream>
#include <fstream>
#include <chrono>
#include <string>
#include <vector>
#include "CudaKeySearchDevice.h"
#include "AddressUtil.h"
void configureRangeStep(unsigned long long);
void resetRangeCounter();
unsigned long long readRangeCounter();
using Wide = unsigned __int128;
std::string decimal(Wide x) {std::string s;do{s=char('0'+x%10)+s;x/=10;}while(x);return s;}
std::string hex(Wide x) {const char*a="0123456789abcdef";std::string s;do{s=a[x%16]+s;x/=16;}while(x);return s;}
Wide parse(const std::string&s){
 if(s.empty()||s.size()>22||(s.size()>1&&s[0]=='0'))throw 1;
 Wide n=0;for(char c:s){if(c<'0'||c>'9')throw 1;n=n*10+c-'0';}return n;
}
int main(int argc,char**argv){
 try{
  if(argc!=5)throw 1;std::string mode=argv[1],id=argv[2];
  if(mode!="scan"&&mode!="inspect")throw 1;
  const Wide lower=Wide(1)<<70,upper=Wide(1)<<71;
  const Wide start=parse(argv[3]),end=parse(argv[4]);
  if(start<lower||end>upper||end<=start||end-start>(Wide(1)<<32))throw 1;
  const bool probe=id=="range-probe-71";
  if(!probe&&id!="puzzle-71")throw 1;
  if(probe&&end>lower+(Wide(1)<<32))throw 1;
  const auto count=static_cast<unsigned long long>(end-start);
  if(mode=="inspect"){
   std::cout<<"{\"targetId\":\""<<id<<"\",\"start\":\""<<decimal(start)<<"\",\"end\":\""<<decimal(end)<<"\",\"attempted\":\""<<count<<"\"}"<<std::endl;return 0;
  }
  const std::string address=probe?"1ASZWacT6EhP8oNjG4iWjWFyKMRexVtNXr":"1PWo3JeB9jrGwfHDNpdGK54CRas7fsVzXU";
  const auto began=std::chrono::steady_clock::now();
  CudaKeySearchDevice device(0,256,64,64);
  device.init(secp256k1::uint256(hex(start)),PointCompressionType::COMPRESSED,secp256k1::uint256(1));
  KeySearchTarget target;Base58::toHash160(address,target.value);std::set<KeySearchTarget> targets;targets.insert(target);device.setTargets(targets);
  resetRangeCounter();const auto batch=device.keysPerStep();if(!batch)throw 1;
  unsigned long long attempted=0,steps=0;bool matched=false,candidate=false;
  while(attempted<count){
   const auto active=std::min<unsigned long long>(batch,count-attempted);configureRangeStep(active);device.doStep();
   const auto measured=readRangeCounter();if(measured!=attempted+active)throw 1;attempted=measured;steps++;
   if(device.getNextKey().cmp(secp256k1::uint256(hex(start+Wide(steps)*batch)))!=0)throw 1;
   std::vector<KeySearchResult> results;device.getResults(results);if(results.size()>1)throw 1;
   for(auto&r:results){
    if(!r.compressed||Address::fromPublicKey(r.publicKey,true)!=address||r.privateKey.cmp(secp256k1::uint256(hex(start)))<0||r.privateKey.cmp(secp256k1::uint256(hex(start+attempted)))>=0||matched)throw 1;
    matched=true;
    if(probe){if(r.privateKey.cmp(secp256k1::uint256(hex(lower+(Wide(1)<<20)+7)))!=0)throw 1;}
    else {std::ofstream secret("/proc/self/fd/3");secret<<r.privateKey.toString()<<std::endl;if(!secret.good())throw 1;candidate=true;}
   }
   if(candidate)break;
   if(std::chrono::duration<double>(std::chrono::steady_clock::now()-began).count()>55)throw 1;
  }
  if(!candidate&&attempted!=count)throw 1;
  if(probe&&matched!=(start<=lower+(Wide(1)<<20)+7&&lower+(Wide(1)<<20)+7<end))throw 1;
  const auto elapsed=std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now()-began).count();
  std::cout<<"{\"schema\":\"bithash.native-range.v1\",\"targetId\":\""<<id<<"\",\"start\":\""<<decimal(start)<<"\",\"end\":\""<<decimal(end)<<"\",\"attempted\":\""<<attempted<<"\",\"status\":\""<<(candidate?"candidate":"completed")<<"\",\"matched\":"<<(matched?"true":"false")<<",\"elapsedNanoseconds\":\""<<elapsed<<"\"}"<<std::endl;return 0;
 }catch(...){std::cerr<<"Bounded range failed"<<std::endl;return 1;}
}
