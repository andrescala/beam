import { HashRouter, Routes, Route } from 'react-router-dom'
import Home from './views/Home'
import Recorder from './views/Recorder'
import Editor from './views/Editor'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/recorder" element={<Recorder />} />
        <Route path="/editor/:projectId" element={<Editor />} />
      </Routes>
    </HashRouter>
  )
}

export default App
