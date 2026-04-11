import { useState, useEffect } from 'react'
import styles from './Countdown.module.css'

function Countdown({ onComplete, from = 3 }) {
  const [count, setCount] = useState(from)

  useEffect(() => {
    if (count <= 0) {
      onComplete()
      return
    }
    const timer = setTimeout(() => setCount(count - 1), 1000)
    return () => clearTimeout(timer)
  }, [count])

  return (
    <div className={styles.overlay}>
      <div className={styles.number} key={count}>
        {count}
      </div>
    </div>
  )
}

export default Countdown
