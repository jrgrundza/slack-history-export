'use strict';

import _ from 'lodash';
import {SlackAPI} from './slack.api.js';
import jsonfile from 'jsonfile';
import csv from 'fast-csv';

jsonfile.spaces = 4;

function fetchGroups(slack) {
  return new Promise((resolve, reject) => {
    slack.groups().then((groups) => {
      resolve(groups);
    }).catch(error => {
      reject(error);
    });
  });
}

function getGroupHistory(slack, groupTotalHistory, channel, latest) {
  return new Promise((resolve, reject) => {
    return slack.groupHistory({channel, latest}).then((groupHistory) => {
      groupTotalHistory.push(...groupHistory.messages);
      if (groupHistory.has_more) {
        return Promise.all([getGroupHistory(slack, groupTotalHistory, channel, groupHistory.messages[groupHistory.messages.length - 1].ts)]).then(function() {
          resolve(groupTotalHistory);
        });
      } else {
        resolve(groupTotalHistory);
      }
    }).catch((error) => {
      reject(error);
    });
  });
}

function getGroupInfo(data, groupName) {
  return _.find(data.groups, (group) => {
    return group.name === groupName;
  });
}

function reverseUserId(slack, data) {
  return new Promise((resolve, reject) => {
    return slack.users().then(users => {
      for (let msg of data) {
        if (msg.user) {
          const userObj = getUserInfoById(users, msg.user);
          msg.user = userObj ? userObj.name : msg.user;
        }
      }
      resolve(data);
    }).catch(error => {
      reject(error);
    });
  });
}

function fetchChannels(slack) {
  return new Promise((resolve, reject) => {
    slack.channels().then((channels) => {
      resolve(channels);
    }).catch((error) => {
      reject(error);
    });
  });
}

function getChannelHistory(slack, channelTotalHistory, channel, latest) {
  return new Promise((resolve, reject) => {
    return slack.channelsHistory({channel, latest}).then((channelHistory) => {
      channelTotalHistory.push(...channelHistory.messages);
      if (channelHistory.has_more) {
        return Promise.all([getChannelHistory(slack, channelTotalHistory, channel, channelHistory.messages[channelHistory.messages.length - 1].ts)]).then(function() {
          resolve(channelTotalHistory);
        });
      } else {
        resolve(channelTotalHistory);
      }
    }).catch((error) => {
      reject(error);
    });
  });
}

function getChannelInfo(data, channelName) {
  return _.find(data.channels, (channel) => {
    return channel.name === channelName;
  });
}


function fetchUser(slack, username) {
  return new Promise((resolve, reject) => {
    slack.users().then((users) => {
      const user = getUserInfo(users, username);
      if (!user) {
        throw new Error('Username is invalid, please check and try again.');
      }
      resolve(user);
    }).catch(error => {
      reject(error);
    });
  });
}

// TODO #refactor map user id to userobj
function getUserInfoById(users, userid) {
  return _.find(users.members, (user) => {
    return user.id === userid;
  });
}

function getUserInfo(users, username) {
  return _.find(users.members, (user) => {
    return user.name === username;
  });
}

function fetchIMs(slack, userId) {
  return new Promise((resolve, reject) => {
    slack.im().then(IMs => {
      let imInfo = getUserIMInfo(IMs, userId);
      if (!imInfo) {
        throw new Error('You do not have any IM history with this user');
      }
      resolve(imInfo);
    }).catch((error) => {
      reject(error);
    });
  });
}

function getSelfData(slack) {
  return new Promise((resolve, reject) => {
    slack.getSelfData().then(userData => {
      resolve(userData);
    }).catch(error => {
      reject(error);
    });
  });
}

function getUserIMInfo(ims, userId) {
  return _.find(ims.ims, (im) => {
    return im.user === userId;
  });
}

function getIMHistory(slack, imTotalHistory, channel, latest) {
  return new Promise((resolve, reject) => {
    slack.imHistory({channel, latest}).then((imHistory) => {
      imTotalHistory.push(...imHistory.messages);
      if (imHistory.has_more) {
        return Promise.all([getIMHistory(slack, imTotalHistory, channel, imHistory.messages[imHistory.messages.length - 1].ts)]).then(function() {
          resolve(imTotalHistory);
        });
      } else {
        resolve(imTotalHistory);
      }
    }).catch((error) => {
      reject(error);
    });
  });
}

function cleanData(slack, data, user) {
  return new Promise((resolve, reject) => {
    let formatDate = function(_data) {
      _data.date = _data.ts;
      delete _data.ts;
      _data.date = new Date(_data.date*1e3);
      return _data;
    };
    getSelfData(slack).then(userData => {
      for(let msg of data) {
        if (msg.user === userData.user_id) {
          msg.user = userData.user;
          msg = formatDate(msg);
        } else {
          msg.user = user.name;
          msg = formatDate(msg);
        }
      }
      resolve(data);
    }).catch(error => {
      reject(error);
    });
  });
}

export function processIM(token, username) {
  return new Promise((resolve, reject) => {
    const slack = new SlackAPI(token);
    const imTotalHistory = [];
    let user = {};
    fetchUser(slack, username).then((userObj) => {
      user = userObj;
      fetchIMs(slack, user.id).then((imInfo) => {
        getIMHistory(slack, imTotalHistory, imInfo.id).then((history) => {
          cleanData(slack, history, user).then(cleanHistory => {
            resolve(cleanHistory);
          }).catch(error => {
            reject(error);
          });
        }).catch(error => {
          reject(error);
        });
      }).catch(error => {
        reject(error);
      });
    }).catch(error => {
      reject(error);
    });
  });
}

export function processGroup(token, groupName) {
  return new Promise((resolve, reject) => {
    const slack = new SlackAPI(token);
    return fetchGroups(slack).then(groups => {
      var group = getGroupInfo(groups, groupName);
      if (!group) {
        return reject(new Error("Group does not exist. Check group name and try again."));
      }
      var groupTotalHistory = [];
      return getGroupHistory(slack, groupTotalHistory, group.id).then((groupHistory) => {
        return reverseUserId(slack, groupHistory).then(refinedHistory => {
          return resolve(refinedHistory);
        }).catch(error => {
          return reject(error);
        });
      }).catch(error => {
        return reject(error);
      });
    }).catch(error => {
      return reject(error);
    });
  });
}

export function processChannel(token, channelName) {
  return new Promise((resolve, reject) => {
    const slack = new SlackAPI(token);
    return fetchChannels(slack).then(channels => {
      var channel = getChannelInfo(channels, channelName);
      if (!channel) {
        return reject(new Error("Channel does not exist. Check channel name and try again."));
      }
      var channelTotalHistory = [];
      return getChannelHistory(slack,channelTotalHistory,channel.id).then((channelHistory) => {
        return reverseUserId(slack, channelHistory).then(refinedHistory => {
          resolve(refinedHistory);
        }).catch(error => {
          reject(error);
        });
      }).catch((error) => {
        reject(error);
      });
    }).catch(error => {
      reject(error);
    });
  });
}

export function saveData(data, args, progress, filename) {
  let currentDir = args.directory || process.cwd();
  const filePath = (args.filename) ? (/\.json$/.test(args.filename)) ? `${currentDir}/${args.filename}` : `${currentDir}/${args.filename}.json` : `${currentDir}/${Date.now()}-${filename}-slack-history.json`;
  if (args.format === 'csv') {
    csv.writeToPath(`${filePath}.csv`, data, {
      headers: true,
      transform: (row) => {
        return {
          Date: row.date,
          User: row.user,
          Message: row.text
        };
      }
    }).on('finish', () => {
      progress.stop();
      console.log(`Done! file saved at ${filePath}.csv`);
    });
  } else {
    jsonfile.writeFile(`${filePath}`, data, function(err) {
      if (!err) {
        progress.stop();
        console.log(`Done! file saved at ${filePath}`);
      } else {
        throw err;
      }
    });
  }
}
