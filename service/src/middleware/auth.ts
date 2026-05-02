import { fetchNewApiSession } from '../newapi'
import { isNotEmptyString } from '../utils/is'

const auth = async (req, res, next) => {
  const AUTH_SECRET_KEY = process.env.AUTH_SECRET_KEY
  const Authorization = req.header('Authorization')

  const newApiSession = await fetchNewApiSession(req)
  if (newApiSession?.logged_in) {
    ;(req as any).newApiUser = newApiSession.user
    ;(req as any).newApiSession = newApiSession
    next()
    return
  }

  if (isNotEmptyString(AUTH_SECRET_KEY) && Authorization?.replace('Bearer ', '').trim() === AUTH_SECRET_KEY.trim()) {
    next()
    return
  }

  if (isNotEmptyString(AUTH_SECRET_KEY)) {
    res.send({ status: 'Unauthorized', message: 'Please authenticate.', data: null })
  }
  else {
    next()
  }
}

/** Strict auth for admin routes - always requires AUTH_SECRET_KEY */
const adminAuth = async (req, res, next) => {
  const AUTH_SECRET_KEY = process.env.AUTH_SECRET_KEY
  if (!isNotEmptyString(AUTH_SECRET_KEY)) {
    res.status(403).json({ status: 'Fail', message: 'Admin key not configured', data: null })
    return
  }
  try {
    const Authorization = req.header('Authorization')
    if (!Authorization || Authorization.replace('Bearer ', '').trim() !== AUTH_SECRET_KEY.trim())
      throw new Error('Error: No access rights')
    next()
  }
  catch (error) {
    res.send({ status: 'Unauthorized', message: error.message ?? 'Please authenticate.', data: null })
  }
}

export { auth, adminAuth }
