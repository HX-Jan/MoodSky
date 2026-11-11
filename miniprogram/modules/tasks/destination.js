function activityDestination(tags = []) {
  if (tags.includes('记录心情')) {
    return 'journal';
  }
  if (tags.some((tag) => ['户外', 'outdoor', '散步', '散心', '校园阅读'].includes(tag))) {
    return 'campus';
  }
  return '';
}

module.exports = { activityDestination };
