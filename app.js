const express = require("express");
const app = express();
app.use(express.json());
const { open } = require("sqlite");
const path = require("path");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
let db = null;

const dbPath = path.join(__dirname, "twitterClone.db");

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is Running");
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
};

initializeDbAndServer();

const authToken = (request, response, next) => {
  const authToken = request.headers["authorization"];
  let jwtToken;
  if (authToken !== undefined) {
    jwtToken = authToken.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        next();
      }
    });
  }
};

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request.params;
  const { tweetId } = request.params;
  const getTweetQuery = `
    SELECT
        *
    FROM
        tweet INNER JOIN  follower ON  tweet.user_id = follower.following_user_id
    WHERE
        tweet.tweet_id = '${tweetId}' AND follower_user_id = '${userId}';`;

  const tweet = await db.get(getTweetQuery);
  console.log(tweet);
  if (tweet === undefined) {
    response.status(400);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashPassword = await bcrypt.hash(password, 10);
  const query = `
    SELECT * FROM user WHERE username = '${username}'`;

  const isUserRegistered = await db.get(query);

  if (isUserRegistered !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const registeringQuery = `
        INSERT INTO user (username, password, name, gender)
        VALUES (
            '${username}', 
            '${hashPassword}', 
            '${name}',
            '${gender}')`;
      await db.run(registeringQuery);
      response.send("User created successfully");
    }
  }
});

app.post("/login/", async (request, response) => {
  let jwtToken;
  const { username, password } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}'`;

  const user = await db.get(getUserQuery);
  if (user === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isValidPwd = await bcrypt.compare(password, user.password);
    if (isValidPwd) {
      const payload = { username: username };
      jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send(jwtToken);
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const getFollowingPeopleIdOfUser = async (username) => {
  const getTheFollowingPeopleQuery = `
    SELECT
        following_user_id
    FROM
        follower INNER JOIN user ON follower.follower_user_id = user.user_id
    WHERE
        user.username = '${username}'`;

  await db.all(getTheFollowingPeopleQuery);
};

app.get("/user/tweets/feed/", authToken, async (request, response) => {
  const { username } = request;
  const followingPeopleIds = await getFollowingPeopleIdOfUser(username);
  const getTweetsQuery = `SELECT
   username, tweet, date_time AS dateTime
   From
     user Inner JOIN tweet ON user.user_id = tweet.user_id
   ORDER BY date_time DESC
   LIMIT 4;`;

  const tweet = await db.all(getTweetsQuery);
  response.send(tweet);
});

app.get("/user/following/", authToken, async (request, response) => {
  const { username, user_id } = request;

  const getNamesQuery = `
    SELECT DISTINCT name FROM user INNER JOIN follower ON 
    user.user_id = follower.following_user_id`;

  const names = await db.all(getNamesQuery);
  response.send(names);
});

app.get(
  "/tweets/:tweetId/",
  authToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweet = `
    SELECT tweet, Count(like_id) AS likes,Count(reply) AS replies, date_time AS dateTime
    FROM
      (tweet INNER JOIN reply ON tweet.user_id = reply.user_id) AS 
      tweet_reply INNER JOIN like ON like.user_id = tweet.user_id
    WHERE
      tweet.tweet_id = ${tweetId}`;
    const tweet = await db.get(getTweet);
    console.log(tweet);
    response.send(tweet);
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `SELECT username
  FROM user INNER JOIN like ON user.user_id = like.user_id
  WHERE tweet_id = '${tweetId}'`;

    const likedUsers = await db.all(getLikesQuery);
    const usersArray = likedUsers.map((eachUser) => eachUser.username);
    response.send({ likes: usersArray });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getReplyQuery = `
    SELECT name, reply FROM user INNER JOIN reply ON
    user.user_id = reply.user_id
    WHERE
      tweet_id = '${tweetId}';`;

    const usersReply = await db.all(getReplyQuery);
    const userAndReply = usersReply.map((each) => each);
    response.send({
      replies: usersReply,
    });
  }
);

app.get("/user/tweets/", authToken, async (request, response) => {
  const { userId } = request;
  const getTweetQuery = `
  SELECT tweet, COUNT(DISTINCT like_id) AS likes,
  COUNT(DISTINCT reply_id) AS replies,
  date_time AS dateTime
  FROM tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id INNER JOIN like ON
  tweet.tweet_id = like.tweet_id
  WHERE tweet.user_id = ${userId}
  GROUP BY
  tweet.tweet_id;`;

  const tweets = await db.all(getTweetQuery);
  response.send(tweets);
});

app.post("/user/tweets/", authToken, async (request, response) => {
  const { tweet } = request.body;
  const createTweetQuery = `INSERT
    INTO tweet(tweet)
    VALUES('${tweet}')
    `;

  const tweetCreated = await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

app.delete("/tweets/:tweetId/", async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getTweetQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId}`;

  const tweet = await db.get(getTweetQuery);

  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
    await db.run(deleteQuery);
    response.send("Tweet Removed");
  }
  response.send("Tweet Removed");
});

module.exports = app;
