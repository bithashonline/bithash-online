#pragma once
#include <vector>
#include <string>
struct VectorTarget {std::string address; long long offset; bool expected;};
struct VectorCase {std::string id,mode; int blocks,threads,points; unsigned long long start,count; std::vector<VectorTarget> targets;};
const std::vector<VectorCase> vectors = {
{"small","validate",64,256,64,1099511627776ULL,2097152ULL,{{"1JSKV3Y8HxBCKPA5fo6mGurfaHHq79kA3Z",0LL,true},{"1GyMJVTHrzQdPL3xc5mugK8Zvm1uwGC8X4",1048575LL,true},{"15SsG1mW7yq8veyxRkGj8qP8QjxJp766jr",1048576LL,true},{"1H3HCA3iGBym4M3UQ5MowxRoWSN3W3VmwP",2097151LL,true},{"19L4hSQmtwr1PbrFZydeLP66XxoCdwY3hE",-1LL,false},{"13ZeVc6xvRb9hAckWe14MdfhbN63CB14ii",2097152LL,false}}},
{"small","benchmark",64,256,64,1099511627776ULL,34359738368ULL,{{"1E2ZeBuxT13LUU7Ld3sWGT1Bqt4RbicqUf",34359738367LL,true},{"1JMhkszzT7MDNf3ZAKCMyCsFtHFsgu5yw1",34359738368LL,false}}},
{"medium","validate",128,256,128,1099511627776ULL,8388608ULL,{{"1JSKV3Y8HxBCKPA5fo6mGurfaHHq79kA3Z",0LL,true},{"197NZAPfXy7Vgty9qFKnuroCy26Dr2woQV",4194303LL,true},{"1FSFmdR95Ngg3PoaycRSsYHgGZY3gWqo25",4194304LL,true},{"16pQFYLdgAEP15pmjxXRLH3G2ipYJjU9eL",8388607LL,true},{"19L4hSQmtwr1PbrFZydeLP66XxoCdwY3hE",-1LL,false},{"1CStwRdaLUoqpZqAhXB9MqdGg5JBQriEAr",8388608LL,false}}},
{"medium","benchmark",128,256,128,1099511627776ULL,34359738368ULL,{{"1E2ZeBuxT13LUU7Ld3sWGT1Bqt4RbicqUf",34359738367LL,true},{"1JMhkszzT7MDNf3ZAKCMyCsFtHFsgu5yw1",34359738368LL,false}}},
{"large","validate",128,256,256,1099511627776ULL,16777216ULL,{{"1JSKV3Y8HxBCKPA5fo6mGurfaHHq79kA3Z",0LL,true},{"16pQFYLdgAEP15pmjxXRLH3G2ipYJjU9eL",8388607LL,true},{"1CStwRdaLUoqpZqAhXB9MqdGg5JBQriEAr",8388608LL,true},{"14q4WjN4iyQ9ZrM7fqztYo9LW5uCnwMzVg",16777215LL,true},{"19L4hSQmtwr1PbrFZydeLP66XxoCdwY3hE",-1LL,false},{"1LuanRUkweUesvCfUtoPrtuYcn7caDcWVg",16777216LL,false}}},
{"large","benchmark",128,256,256,1099511627776ULL,34359738368ULL,{{"1E2ZeBuxT13LUU7Ld3sWGT1Bqt4RbicqUf",34359738367LL,true},{"1JMhkszzT7MDNf3ZAKCMyCsFtHFsgu5yw1",34359738368LL,false}}},
};
