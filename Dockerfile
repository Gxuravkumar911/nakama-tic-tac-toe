FROM registry.heroiclabs.com/heroiclabs/nakama:3.21.1

COPY nakama/build/*.js /nakama/data/modules/build/
COPY nakama/local.yml /nakama/data/local.yml
