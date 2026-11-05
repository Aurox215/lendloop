import { ToolPage } from '../../../components/tools/ToolPage'

export default async function DetailPage({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params
  return <ToolPage toolId={toolId} />
}
