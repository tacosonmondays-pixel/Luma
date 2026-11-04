# Setting up Luma's server (Supabase)

Luma works without this. With it, you can sign in, back up your library to the server, sync it to other devices and share a public profile page. You do these steps once, in the Supabase dashboard of project `kbdevcrqrjnqxsfeszbe`.

The app already holds the project URL and the publishable key (`src/lib/supabase.ts`). Both are public. Never put the `service_role` key or any secret key in the app or the repo.

## 1. Create the database

The database comes in files in `supabase/migrations/`, run in order: `0001_luma.sql`, then `0002_social.sql`.

1. Open the project in the Supabase dashboard.
2. In the left sidebar, click **SQL Editor**.
3. Click **New query**.
4. Paste 0001, Run; then paste 0002, Run. That is: open `supabase/migrations/0001_luma.sql` from this repo, copy all of it, paste it into the editor and click **Run**. Then replace it with all of `supabase/migrations/0002_social.sql` and click **Run** again. Each time you should see "Success. No rows returned".

**Whenever you run 0001 again, run 0002 after it.** 0001 resets permissions that 0002 adds: on its own, it stops posts from carrying a song until 0002 runs again.

You can run the files again later, for example after an update (always in order). They don't delete data, except values outside the current limits (only a crafted request could have written them).

To check: click **Table Editor**. You should see `profiles`, `invites`, `follows`, `plays`, `library_tracks`, `library_playlists`, `videos`, `posts` and `reports`. Click **Storage**: a bucket named `media` should be there, marked Public.

## 2. Send a 6-digit code instead of a link

Luma signs in with a code typed into the app. A link would open Safari, and Safari doesn't share storage with the Home Screen app or the iOS app.

1. Click **Authentication** in the left sidebar.
2. Under **Configuration** (newer dashboards call this section **Notifications**), click **Email Templates**. Some dashboards put it at **Emails → Templates**.
3. Click the **Magic Link** template. Email codes use the same template as magic links.
4. Set **Subject** to: `Your Luma code`
5. Replace the **Body** with:

   ```html
   <h2>Your Luma code</h2>
   <p style="font-size:32px;letter-spacing:6px;font-weight:700">{{ .Token }}</p>
   ```

   Leave `{{ .ConfirmationURL }}` out, so the email holds only the code.
6. Click **Save**.
7. Do the same for the **Confirm signup** template, with the same subject and body. Depending on the project's settings, someone's first sign-in can use that template.
8. Go to **Authentication → Sign In / Providers** (older dashboards: **Providers**). Click **Email**. Check:
   - **Enable Email provider** is on.
   - **Email OTP Length** is **6**. The app's code field takes 6 digits. If your dashboard doesn't show this setting, it already uses 6.
   - **Email OTP Expiration** is up to you. 600 seconds (10 minutes) works well.
   - Click **Save**.

Supabase's built-in email service only sends a few emails an hour. That's enough for you and a few friends. For more, add your own SMTP server under **Authentication → Emails → SMTP Settings**.

## 3. Set the site URL

1. Go to **Authentication → URL Configuration**.
2. Set **Site URL** to `https://tacosonmondays-pixel.github.io/Luma/`
3. Click **Save**.

## 4. Make yourself admin

1. Open Luma, either the GitHub Pages site or the app. Go to **You → Sign In**, enter your email and type the code you receive. This creates your account. You can close the sheet when it asks for an invite code.
2. Back in the **SQL Editor**, run this query with your own email:

   ```sql
   select make_admin('you@example.com');
   ```

   It returns your user id. You're now a member and an admin. The app can't run this function at all: only the SQL Editor can.
3. In Luma, close the sign-in sheet and open it again (or reload). It asks for a handle. Pick one with 3 to 20 lowercase letters, digits or `_`.

## 5. Create invite codes

Each code works once and expires after 30 days. Run this in the **SQL Editor** to make 5 codes:

```sql
select * from create_invites(5);
```

`create_invites`, `admin_remove`, `admin_ban`, `admin_purge` and `admin_dismiss` work for admins in the app and for you in the SQL Editor. For codes that never expire, use `create_invites(5, null)`.

Send each friend one code. In Luma they go to **You → Sign In**, enter their email and the emailed code, then the invite code and a handle.

To see which codes are used: `select * from invites order by created_at desc;` A code with `used_at` set is used for good, even when `used_by` is empty (the account that used it was deleted).

## Moderation

From the SQL Editor:

- Ban someone: `select admin_ban('<user id>');` To unban: `select admin_ban('<user id>', false);` A ban sticks to the email too: if you delete the account in **Authentication → Users**, signing up again with that email stays banned. To lift that for a deleted account: `delete from luma.banned_emails where email = 'them@example.com';`
- After a ban, remove everything they posted and clear their profile: `select admin_purge('<user id>');` Ban in the app does both, and deletes their files too. An unban doesn't bring any of it back.
- Hide a post or video: `select admin_remove('post', '<id>');` or `select admin_remove('video', '<id>');`
- Clear a profile's name, bio and pictures: `select admin_remove('profile', '<user id>');`
- Close a target's reports and leave it be: `select admin_dismiss('post', '<id>');` (or `'video'`, `'profile'`).
- Open reports: `select * from reports where resolved_at is null;`

These always work, whatever a member has written to their own rows.

Each member also has limits, so nobody can fill the free plan: 100 posts and 25 videos a day, 50 open reports, 20,000 songs and 2,000 playlists in their backup, their newest 5,000 plays, and 200 MB and 2,000 files in Storage (admins have no Storage limit). `docs/server.md` lists them all. To change the Storage quota, edit the number in `luma.media_quota()` in `0002_social.sql` and run it again. To see what someone has left, run `select media_left();` as them, or look at their folder in **Storage → media**.

Hiding content from the SQL Editor doesn't delete its files from Storage. The bucket is public, so anyone who already has a file's address can still open it. To remove the files too, open **Storage → media → \<user id\>** and delete them. Remove and Ban in the app delete the files first. Posted images and videos are cached for a day, so a deleted one can still show for up to a day at its old address.

## What the server never stores

Song audio. Library sync sends titles, artists, durations and playlists, nothing more. On a new device, synced songs show as not downloaded until you download them again. A post or video can name the song that was playing, as text. The `media` bucket only accepts images and videos (avatar, banner, profile background, posted videos and post images), up to 50 MB per file, the limit of Supabase's free plan.
