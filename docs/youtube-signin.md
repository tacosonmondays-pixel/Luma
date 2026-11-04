# Setting up Connect YouTube (Google sign-in)

Luma works without this. With it, **You → YouTube** signs in with Google and lists your YouTube playlists, including Liked videos, to import as playlists linked to YouTube. You do these steps once, in [Google Cloud](https://console.cloud.google.com).

Luma uses Google's browser sign-in (the Google Identity Services token client). It has no client secret: the client ID is public, and only the origins you list below can use it. Luma asks for one permission, `youtube.readonly`: it can read your playlists and likes, and change nothing. The sign-in lasts an hour and only in the tab it was made in.

## 1. Pick a project and turn on the YouTube API

1. Open https://console.cloud.google.com and sign in.
2. At the top, click the project picker. Choose the project that holds your YouTube key (**You → YouTube Key**), or click **New Project**, name it `Luma`, and click **Create**.
3. In the left menu, click **APIs & Services → Library**.
4. Search for **YouTube Data API v3**, click it, and click **Enable**. If it says **Manage**, it is already on.

## 2. Set up the consent screen

1. Click **APIs & Services → OAuth consent screen**. Newer consoles call this **Google Auth Platform**; click **Get started** if it asks.
2. **App name**: `Luma`. **User support email**: your email. Click **Next**.
3. **Audience**: choose **External**. Click **Next**.
4. **Contact information**: your email. Click **Next**, agree to the policy, and click **Create**.
5. Click **Audience** (older consoles: the **Test users** section of the consent screen). Leave **Publishing status** on **Testing**. Don't publish the app: Google would want to review it.
6. Under **Test users**, click **Add users**, enter the Google account you use on YouTube, and click **Save**. Only test users can sign in.
7. Click **Data Access** (older consoles: **Scopes**), then **Add or remove scopes**. Find `.../auth/youtube.readonly` (YouTube Data API v3), check it, click **Update**, then **Save**.

## 3. Create the client

1. Click **Clients** (older consoles: **APIs & Services → Credentials → Create credentials → OAuth client ID**).
2. Click **Create client**. **Application type**: **Web application**. **Name**: `Luma web`.
3. Under **Authorized JavaScript origins**, click **Add URI** twice and enter:
   - `https://tacosonmondays-pixel.github.io`
   - `http://localhost:4848`
4. Leave **Authorized redirect URIs** empty. Click **Create**.
5. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). Ignore the client secret: Luma doesn't use it, and it must never go in the repo.

## 4. Put the client ID in Luma

Open `src/lib/google-config.ts` and set:

```ts
export const GOOGLE_CLIENT_ID = '123456789-abc.apps.googleusercontent.com'
```

Commit it. It is public by design. Until it is set, the YouTube row stays hidden.

To check: open Luma at one of the two origins, go to **You**, tap **YouTube**, and sign in. Your playlists should appear, Liked Videos first. If Google shows "Access blocked", the account isn't a test user (step 2.6), or the page's address isn't one of the origins (step 3.3).

Using Luma at another `https` address, such as your Tailscale `https://….ts.net` one? Add it as an origin too (step 3.3). The iOS app (`luma://app`) can't sign in with Google: import playlists in the browser, and they sync to your other devices (signed in to Luma's server) as normal playlists.

## 5. Delete old clients whose secret was shared

**If any OAuth client of this project ever had its client secret pasted somewhere public (a chat, an issue, a commit, a screenshot), delete that client.** In **Clients** (or **Credentials**), click the trash icon next to it and confirm. A leaked secret lets anyone act as your app. Deleting a client can't be undone; the new client above replaces it.

Also check **APIs & Services → Credentials → API keys**: an API key that was shared publicly should be deleted or restricted (Luma's YouTube key belongs on your devices only, restricted as the README describes).
