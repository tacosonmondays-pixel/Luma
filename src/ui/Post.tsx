// A post as a card (Home, Search, You, a profile's grid): its face is a video's still, the first image, or the text,
// at 3:4. Lists show stills only; the Viewer plays. With `author`, the card names who posted it.
import { useState } from 'react'
import { loadPosts, useSocial, type Person, type Post } from '../lib/social.ts'
import { openPost } from '../lib/viewer.ts'
import { PersonAvatar } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { displayName } from './People.tsx'
import { Sentinel } from './Shelf.tsx'
import '../styles/social.css'

/** A picture that hides itself when it can't load (the card's fill shows instead). */
function Face({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
}

export function PostCard({ post, author, onOpen = () => openPost(post) }: { post: Post; author?: Person; onOpen?: () => void }) {
  const still = post.video ? post.video.still : post.images[0]
  const label = post.text.trim().slice(0, 80) || (author ? displayName(author) : 'Post')
  return (
    <button type="button" className="card post-card" aria-label={label} onClick={onOpen}>
      <span className="post-face">
        {still ? <Face src={still} /> : <span className="post-text">{post.text}</span>}
        {post.video && (
          <span className="post-badge post-badge-top" aria-hidden="true">
            <Icon name="film" size={16} />
          </span>
        )}
        {post.song && (
          <span className="post-badge post-badge-bottom" aria-hidden="true">
            <Icon name="music" size={14} />
          </span>
        )}
      </span>
      {author && (
        <span className="card-sub post-author">
          <PersonAvatar person={author} size={18} />
          <span className="ellipsis">{displayName(author)}</span>
        </span>
      )}
    </button>
  )
}

/** Someone's posts on their profile: a grid, the next page loading as its end scrolls near. */
export function PostGrid({ userId }: { userId: string }) {
  const list = useSocial((s) => s.lists[userId])
  if (!list?.items.length) return null
  return (
    <>
      <div className="post-grid">
        {list.items.map((post) => (
          <PostCard key={`${post.kind}:${post.id}`} post={post} />
        ))}
      </div>
      {!list.done && list.cursor && <Sentinel key={list.cursor} onNear={() => void loadPosts(userId, true)} />}
    </>
  )
}
